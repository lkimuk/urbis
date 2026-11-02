import copy
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_gdp', ROOT / 'scripts/prepare-gdp.py')
gdp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gdp)


class GdpSnapshotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((ROOT / 'resources/catalog.json').read_text(encoding='utf-8'))
        cls.snapshot, cls.report = gdp.build(ROOT / 'data/gdp', cls.catalog)
        cls.records = {row['regionId']: row for row in cls.snapshot['records']}

    def test_snapshot_and_coverage_are_reproducible(self):
        for filename, value in [('gdp-2024.json', self.snapshot), ('coverage-2024.json', self.report)]:
            self.assertEqual(value, json.loads((ROOT / 'data/gdp' / filename).read_text(encoding='utf-8')))
        self.assertEqual(self.report['counts'], {'country': 1, 'province': 31, 'city': 21, 'county': 122})
        self.assertEqual(self.report['missingProvinceIds'], ['710000', '810000', '820000'])
        self.assertEqual(self.report['missingGuangdongCountyIds'], ['tdt-county-441900', 'tdt-county-442000'])

    def test_gdp_columns_and_statistical_scope(self):
        self.assertEqual(self.records['100000']['value'], 1349083.5)
        self.assertEqual(self.records['440000']['value'], 141633.8)
        self.assertEqual(self.records['tdt-440100']['value'], 31032.50)
        self.assertEqual(self.records['tdt-county-440104']['value'], 3511.89)
        self.assertIn('深汕合作区', self.records['tdt-county-441521']['scopeNote'])
        self.assertEqual(self.records['tdt-county-440232']['sourceName'], '乳源县')
        self.assertEqual(self.records['tdt-county-441502']['sourceName'], '市城区')
        self.assertLess(self.report['provinceSum'], self.report['nationalValue'])
        self.assertEqual(self.records['110000']['status'], 'preliminary')
        self.assertEqual(self.records['tdt-440100']['status'], 'as-published')

    def test_changed_source_bytes_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / 'gdp'
            shutil.copytree(ROOT / 'data/gdp', directory)
            with (directory / 'sources/gd-2025-23-01-0.htm').open('ab') as file:
                file.write(b'changed')
            with self.assertRaisesRegex(ValueError, 'Source bytes changed'):
                gdp.build(directory, self.catalog)

    def test_ambiguous_parent_mapping_is_rejected(self):
        catalog = copy.deepcopy(self.catalog)
        duplicate = copy.deepcopy(next(row for row in catalog if row['id'] == 'tdt-county-440104'))
        duplicate['id'] = 'duplicate-county'
        catalog.append(duplicate)
        with self.assertRaisesRegex(ValueError, 'Ambiguous county'):
            gdp.build(ROOT / 'data/gdp', catalog)


class AnnualGdpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((ROOT / 'resources/catalog.json').read_text(encoding='utf-8'))
        cls.data_dir = ROOT / 'data/gdp'
        cls.manifest = json.loads((cls.data_dir / 'manifest-2025.json').read_text(encoding='utf-8'))

    def test_offline_annual_rebuild_and_gaps(self):
        snapshot, report = gdp.build(self.data_dir, self.catalog, 2025)
        for filename, value in [('gdp-2025.json', snapshot), ('coverage-2025.json', report)]:
            self.assertEqual(value, json.loads((self.data_dir / filename).read_text(encoding='utf-8')))
        self.assertEqual(report['counts'], {'country': 1, 'province': 30, 'city': 0, 'county': 0})
        self.assertEqual(report['missingProvinceIds'], ['620000', '710000', '810000', '820000'])
        records = {row['regionId']: row for row in snapshot['records']}
        self.assertEqual(records['100000']['value'], 1401879)
        self.assertEqual(records['130000']['value'], 49305.2)
        self.assertEqual(records['500000']['value'], 33757.93)
        self.assertEqual(records['520000']['value'], 23562.17)
        self.assertEqual(records['310000']['value'], 56708.71)
        self.assertEqual(records['630000']['value'], 4121.84)
        self.assertTrue(all(row['status'] == 'preliminary' for row in snapshot['records']))

    def test_cli_writes_valid_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(
                [sys.executable, str(ROOT / 'scripts/prepare-gdp.py'), '--year', '2025', '--output', tmp],
                check=True, capture_output=True, text=True,
            )
            for filename in ('gdp-2025.json', 'coverage-2025.json'):
                raw = (Path(tmp) / filename).read_bytes()
                self.assertTrue(raw.endswith(b'\n'))
                self.assertEqual(json.loads(raw), json.loads((self.data_dir / filename).read_bytes()))

    def test_annual_review_mismatches_are_rejected(self):
        cases = [
            ('value', '5.0', 'does not match evidence'),
            ('year', 2024, 'year or status'),
            ('regionName', '河南省', 'region mapping'),
            ('publishedOn', '2026-02-27', 'Publication date missing'),
        ]
        for key, value, error in cases:
            with self.subTest(key=key):
                manifest = copy.deepcopy(self.manifest)
                manifest['sources'][0][key] = value
                with self.assertRaisesRegex(ValueError, error):
                    gdp.build_annual(self.data_dir, self.catalog, manifest)
        for key, value, error in [
            ('valueQuote', '地区生产总值1401879万元', 'evidence missing'),
            ('yearQuote', '2024年', 'evidence year mismatch'),
            ('regionTerm', '河南', 'publisher identity'),
        ]:
            with self.subTest(evidence=key):
                manifest = copy.deepcopy(self.manifest)
                manifest['sources'][0]['evidence'][key] = value
                with self.assertRaisesRegex(ValueError, error):
                    gdp.build_annual(self.data_dir, self.catalog, manifest)
        manifest = copy.deepcopy(self.manifest)
        manifest['sources'].append(copy.deepcopy(manifest['sources'][0]))
        with self.assertRaisesRegex(ValueError, 'Duplicate annual observation'):
            gdp.build_annual(self.data_dir, self.catalog, manifest)

    def test_annual_changed_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / 'gdp'
            shutil.copytree(self.data_dir, directory)
            filename = self.manifest['sources'][0]['file']
            with (directory / 'sources' / filename).open('ab') as file:
                file.write(b'changed')
            with self.assertRaisesRegex(ValueError, 'Source bytes changed'):
                gdp.build(directory, self.catalog, 2025)


if __name__ == '__main__':
    unittest.main()
