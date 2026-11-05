import copy
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from decimal import Decimal
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
        self.assertEqual(report['counts'], {'country': 1, 'province': 31, 'city': 152, 'county': 25})
        self.assertEqual(report['missingProvinceIds'], ['710000', '810000', '820000'])
        records = {row['regionId']: row for row in snapshot['records']}
        self.assertEqual(records['100000']['value'], 1401879)
        self.assertEqual(records['130000']['value'], 49305.2)
        self.assertEqual(records['500000']['value'], 33757.93)
        self.assertEqual(records['520000']['value'], 23562.17)
        self.assertEqual(records['310000']['value'], 56708.71)
        self.assertEqual(records['620000']['value'], 13697.5)
        self.assertEqual(records['630000']['value'], 4121.84)
        self.assertTrue(all(row['status'] == 'preliminary' for row in snapshot['records']))
        covered = {r['provinceId']: r for r in report['cityCoverage']}
        self.assertEqual((covered['440000']['covered'], covered['440000']['expected']), (21, 21))
        self.assertEqual((covered['150000']['covered'], covered['150000']['expected']), (12, 12))
        self.assertEqual((covered['430000']['covered'], covered['430000']['expected']), (14, 14))
        self.assertEqual((covered['220000']['covered'], covered['220000']['expected']), (9, 9))
        municipal = {r['provinceId']: r for r in report['municipalityCoverage']}
        self.assertEqual({key: row['covered'] for key, row in municipal.items()},
                         {'110000': 4, '120000': 6, '310000': 1, '500000': 14})

    def test_publication_dates_support_official_formats_without_day_prefixes(self):
        published = date(2026, 5, 8)
        for text in ['2026-05-08', '2026—5—8', '2026年5月8日',
                     '2026-05-082025年公报', '2026-05-0816:55']:
            self.assertTrue(gdp.has_publication_date(text, published), text)
        for text in ['2026-05-18', '2026-05-082', '12026-05-08', '2025年5月8日']:
            self.assertFalse(gdp.has_publication_date(text, published), text)

    def test_reviewed_annual_sentences_preserve_footnotes_and_amount_units(self):
        for quote in ['全年生产总值〔2〕（GDP）1049.66亿元',
                      '全年地区生产总值[2]完成1049.66亿元']:
            source = {'regionId': 'example', 'extraction': 'reviewed-sentence',
                      'evidence': {'valueQuote': quote}}
            self.assertEqual(gdp.annual_amount(source), Decimal('1049.66'))
        source['evidence']['valueQuote'] = '全年地区生产总值增长4.8%'
        with self.assertRaisesRegex(ValueError, 'unit mismatch'):
            gdp.annual_amount(source)

    def test_expanded_official_sources_and_scope(self):
        snapshot, _ = gdp.build(self.data_dir, self.catalog, 2025)
        records = {r['regionId']: r for r in snapshot['records']}
        for rid, amount in [('tdt-220100', 8005.59), ('tdt-222400', 1064.08),
                            ('tdt-451300', 1049.66), ('tdt-511500', 4134.73),
                            ('tdt-county-120102', 528.22), ('tdt-county-120117', 313.89),
                            ('tdt-county-500230', 455.2516), ('tdt-county-500233', 608.37),
                            ('tdt-county-500229', 85.06)]:
            self.assertEqual(records[rid]['value'], amount)
        self.assertNotIn('tdt-county-500157', records)

    def test_city_amount_columns_units_and_display_precision(self):
        snapshot, _ = gdp.build(self.data_dir, self.catalog, 2025)
        rows = {row['regionId']: row for row in snapshot['records']}
        for rid, expected in [('tdt-440100', 32039.46), ('tdt-440300', 38731.80),
                              ('tdt-150100', 4278.3), ('tdt-430800', 667.83),
                              ('tdt-county-110119', 260.8938), ('tdt-county-120110', 783.40),
                              ('tdt-county-120113', 763.1), ('tdt-county-120101', 772.76),
                              ('tdt-county-310104', 4153.08)]:
            self.assertEqual(rows[rid]['value'], expected)
        self.assertNotIn('tdt-county-440104', rows)

    def test_city_parent_and_ordinary_county_scope_are_checked(self):
        source = next(s for s in self.manifest['sources'] if s['regionId'] == 'tdt-440100')
        manifest = {**self.manifest, 'sources': [copy.deepcopy(source)]}
        manifest['sources'][0]['parentId'] = '450000'
        with self.assertRaisesRegex(ValueError, 'parent mapping mismatch'):
            gdp.build_annual(self.data_dir, self.catalog, manifest)
        county = next(r for r in self.catalog if r['id'] == 'tdt-county-440104')
        manifest['sources'][0].update(regionId=county['id'], regionName=county['name'], parentId=county['parentId'])
        with self.assertRaisesRegex(ValueError, 'region mapping mismatch'):
            gdp.build_annual(self.data_dir, self.catalog, manifest)

    def test_growth_column_cannot_replace_gdp_amount(self):
        source = next(s for s in self.manifest['sources'] if s['regionId'] == 'tdt-440100')
        source = copy.deepcopy(source)
        source['evidence']['valueColumn'] = 5
        with self.assertRaisesRegex(ValueError, 'table value mismatch'):
            gdp.build_annual(self.data_dir, self.catalog, {**self.manifest, 'sources': [source]})

    def test_reviewed_transcription_requires_hashed_text_and_publication(self):
        source = next(s for s in self.manifest['sources'] if s['regionId'] == 'tdt-county-310104')
        for key, value, error in [('transcriptionFile', 'unknown.txt', 'Unverified transcription'),
                                  ('publicationFile', None, 'publication source missing')]:
            candidate = {**source, key: value}
            with self.assertRaisesRegex(ValueError, error):
                gdp.build_annual(self.data_dir, self.catalog, {**self.manifest, 'sources': [candidate]})

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
