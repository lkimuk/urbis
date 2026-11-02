import copy
import importlib.util
import json
import shutil
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


if __name__ == '__main__':
    unittest.main()
