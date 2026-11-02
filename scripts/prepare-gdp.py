"""Build reviewed GDP snapshots from checked-in official sources."""
import argparse
import csv
import hashlib
import json
import re
from decimal import Decimal
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


class TableRows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = ''

    def handle_data(self, text):
        if self.cell is not None:
            self.cell += text

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(' '.join(self.cell.split()))
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def table_rows(path):
    parser = TableRows()
    parser.feed(path.read_text(encoding='utf-8'))
    return parser.rows


class ArticleText(HTMLParser):
    """Read visible text and the document title without executing page scripts."""

    def __init__(self):
        super().__init__()
        self.parts = []
        self.title = []
        self.in_title = False
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
        if tag == 'title':
            self.in_title = True

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)
        if tag == 'title':
            self.in_title = False

    def handle_data(self, text):
        if not self.hidden:
            self.parts.append(text)
        if self.in_title:
            self.title.append(text)


def compact(text):
    return re.sub(r'\s+', '', text)


def build_annual(data_dir, catalog, manifest):
    """Validate reviewed evidence against original HTML, then map exact catalog IDs.

    This is an offline review importer, not a general-purpose article scraper.
    Source hash validation belongs to the caller, shared with yearbook imports.
    """
    year = manifest['year']
    if (manifest['unit'], manifest['currency'], manifest['priceBasis']) != ('亿元', 'CNY', 'current'):
        raise ValueError('Unsupported annual GDP unit or price basis')
    regions = {row['id']: row for row in catalog}
    if len(regions) != len(catalog):
        raise ValueError('Duplicate catalog IDs')
    records = []
    seen = set()
    source_ids = set()
    for source in manifest['sources']:
        rid = source['regionId']
        region = regions[rid]
        if rid in seen or source['id'] in source_ids:
            raise ValueError('Duplicate annual observation: ' + rid)
        if region['name'] != source['regionName'] or region['level'] not in ('country', 'province'):
            raise ValueError('Annual region mapping mismatch: ' + rid)
        if source['year'] != year or source['status'] not in ('preliminary', 'final'):
            raise ValueError('Annual year or status mismatch: ' + rid)
        filename = source['file']
        if filename not in manifest['files']:
            raise ValueError('Unverified source file: ' + filename)
        html = (data_dir / 'sources' / filename).read_bytes().decode(source['encoding'])
        parser = ArticleText()
        parser.feed(html)
        text = compact(' '.join(parser.parts))
        evidence = source['evidence']
        # Title identity prevents accepting a different province's page merely
        # because its footer links to all provincial statistics bureaus.
        # Qinghai's table title says only '全省'; its official host identifies
        # the province. Other releases identify their publisher in the title.
        qinghai_table = (rid == '630000' and evidence['regionTerm'] == '青海'
                         and urlparse(source['url']).hostname == 'tjj.qinghai.gov.cn')
        if evidence['regionTerm'] not in compact(''.join(parser.title)) and not qinghai_table:
            raise ValueError('Annual publisher identity mismatch: ' + rid)
        for key in ('valueQuote', 'yearQuote'):
            if not evidence[key] or compact(evidence[key]) not in text:
                raise ValueError('Annual evidence missing from source: ' + rid + '/' + key)
        if str(year) + '年' not in compact(evidence['yearQuote']):
            raise ValueError('Annual evidence year mismatch: ' + rid)
        quote = evidence['valueQuote']
        if '亿元' not in quote:
            raise ValueError('Annual evidence unit mismatch: ' + rid)
        if source['extraction'] == 'html-table':
            match = re.search(r'生产总值\s*(\d+(?:\.\d+)?)\s+\d', quote)
        elif source['extraction'] == 'reviewed-sentence':
            match = re.search(r'生产总值(?:\s*\[\d+\])?(?:（GDP）)?\s*(?:为\s*)?([\d.\s]+?)\s*亿元', quote)
        else:
            raise ValueError('Unsupported annual extraction: ' + rid)
        number = Decimal(source['value'])
        if (not match or not number.is_finite() or number <= 0
                or Decimal(compact(match.group(1))) != number):
            raise ValueError('Annual GDP does not match evidence: ' + rid)
        published = date.fromisoformat(source['publishedOn'])
        if not date(year + 1, 1, 1) <= published <= date.fromisoformat(manifest['retrievedOn']):
            raise ValueError('Invalid annual publication date: ' + rid)
        # Dates may occur in metadata or a page's embedded publication record.
        date_pattern = rf'{published.year}(?:-|/|年)\s*0?{published.month}(?:-|/|月)\s*0?{published.day}(?!\d)'
        if not re.search(date_pattern, html):
            raise ValueError('Publication date missing from source: ' + rid)
        seen.add(rid)
        source_ids.add(source['id'])
        records.append({
            'regionId': rid, 'regionName': region['name'], 'level': region['level'],
            'sourceName': source['regionName'], 'value': float(number),
            'sourceId': source['id'], 'sourceFile': filename,
            'status': source['status'], 'publishedOn': source['publishedOn'],
        })
    snapshot = {key: manifest[key] for key in ('year', 'unit', 'currency', 'priceBasis', 'retrievedOn')}
    snapshot['records'] = sorted(records, key=lambda row: row['regionId'])
    counts = {level: sum(r['level'] == level for r in records) for level in ('country', 'province', 'city', 'county')}
    report = {
        'year': year, 'counts': counts, 'total': len(records),
        'missingProvinceIds': sorted(r['id'] for r in catalog if r['level'] == 'province' and r['id'] not in seen),
        'unavailableSources': manifest['unavailableSources'],
        'nationalValue': next((r['value'] for r in records if r['level'] == 'country'), None),
        'provinceSum': float(sum(Decimal(str(r['value'])) for r in records if r['level'] == 'province')),
        'notes': [
            '采用所存官方年度发布版本；未宣称已排查下载日前全部后续修订。',
            '缺失不填零，不借用2024年或其他年份；城市和区县尚未收录2025年数据。',
            '全国值采用国家统计局原文，不用省级合计替代；当前省级覆盖不全。',
        ],
    }
    return snapshot, report


def build(data_dir, catalog, year=2024):
    manifest_file = 'manifest.json' if year == 2024 else f'manifest-{year}.json'
    manifest = json.loads((data_dir / manifest_file).read_text(encoding='utf-8'))
    if manifest['year'] != year:
        raise ValueError('Manifest year mismatch')
    for filename, expected in manifest['files'].items():
        actual = hashlib.sha256((data_dir / 'sources' / filename).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError('Source bytes changed: ' + filename)
    if year != 2024:
        return build_annual(data_dir, catalog, manifest)
    regions = {region['id']: region for region in catalog}
    if len(regions) != len(catalog):
        raise ValueError('Duplicate catalog IDs')
    sources = {source['id']: source for source in manifest['sources']}
    aliases = json.loads((data_dir / 'region-aliases.json').read_text(encoding='utf-8'))
    records = []
    seen = set()

    def add(region, source_name, value, source_id, source_file, scope_note=''):
        if region['id'] in seen:
            raise ValueError('Duplicate observation: ' + region['id'])
        number = Decimal(value)
        if not number.is_finite() or number <= 0:
            raise ValueError('Invalid GDP: ' + value)
        seen.add(region['id'])
        record = {
            'regionId': region['id'], 'regionName': region['name'],
            'level': region['level'], 'sourceName': source_name,
            'value': float(number), 'sourceId': source_id,
            'sourceFile': source_file, 'status': sources[source_id]['status'],
        }
        if scope_note:
            record['scopeNote'] = scope_note
        records.append(record)

    with (data_dir / 'nbs-2024-transcription.csv').open(encoding='utf-8', newline='') as file:
        for row in csv.DictReader(file):
            region = regions[row['regionId']]
            if region['name'] != row['name'] or region['level'] not in ('country', 'province'):
                raise ValueError('NBS mapping mismatch: ' + row['regionId'])
            kind = 'national' if region['level'] == 'country' else 'provinces'
            source_file = 'nbs-2025-C03-01.jpg' if kind == 'national' else 'nbs-2025-C03-09.jpg'
            add(region, row['name'], row['value'], 'nbs-2025-' + kind, source_file)

    gd = [region for region in catalog if region.get('sourceId', '').startswith('15644')]
    # These four rows are economic aggregates, not administrative cities.
    aggregates = {'珠三角', '粤东', '粤西', '粤北'}
    city_file = 'gd-2025-02-24-0.htm'
    city_count = 0
    for row in table_rows(data_dir / 'sources' / city_file):
        if len(row) < 4 or not re.fullmatch(r'\d+\.\d+', row[2]):
            continue
        name = re.sub(r'\s+', '', row[0])
        if name in aggregates:
            continue
        matches = [region for region in gd if region['level'] == 'city' and region['name'] == name + '市']
        if len(matches) != 1:
            raise ValueError('Ambiguous city: ' + name)
        add(matches[0], name, row[2], 'gd-2025-cities', city_file)
        city_count += 1
    if city_count != 21:
        raise ValueError('Expected 21 Guangdong cities, got ' + str(city_count))

    county_count = 0
    for page in range(3):
        source_file = 'gd-2025-23-01-' + str(page) + '.htm'
        parent = None
        for row in table_rows(data_dir / 'sources' / source_file):
            if len(row) != 6:
                continue
            name = re.sub(r'\s+', '', row[0])
            if name.endswith('市') and not row[2]:
                parent = name
                continue
            if not re.fullmatch(r'\d+\.\d+', row[2]):
                continue
            alias = next((entry for entry in aliases if entry['city'] == parent and entry['sourceName'] == name), None)
            mapped_name = alias['mapName'] if alias else name
            matches = [region for region in gd if region['level'] == 'county' and region['city'] == parent and region['name'] == mapped_name]
            if len(matches) != 1:
                raise ValueError('Ambiguous county: ' + str(parent) + '/' + name)
            # 2023 GDP, 2024 GDP, 2023 index, 2024 index: value is column 4.
            note = '不含深汕合作区；未经范围核对，不直接用于全县地图着色。' if parent == '汕尾市' and name == '海丰县' else ''
            add(matches[0], name, row[3], 'gd-2025-counties', source_file, note)
            county_count += 1
    if county_count != 122:
        raise ValueError('Expected 122 Guangdong county observations, got ' + str(county_count))

    # Do not duplicate city totals into the catalog's whole-city county proxies.
    covered = set(record['regionId'] for record in records)
    missing_provinces = [r['id'] for r in catalog if r['level'] == 'province' and r['id'] not in covered]
    missing_gd_counties = [r['id'] for r in gd if r['level'] == 'county' and r['id'] not in covered]
    counts = {level: sum(r['level'] == level for r in records) for level in ('country', 'province', 'city', 'county')}
    snapshot = {
        'year': manifest['year'], 'unit': manifest['unit'],
        'currency': manifest['currency'], 'priceBasis': manifest['priceBasis'],
        'retrievedOn': manifest['retrievedOn'],
        'records': sorted(records, key=lambda row: row['regionId']),
    }
    report = {
        'year': manifest['year'], 'counts': counts, 'total': len(records),
        'missingProvinceIds': sorted(missing_provinces),
        'missingGuangdongCountyIds': sorted(missing_gd_counties),
        'scopeExceptions': [r['regionId'] for r in records if 'scopeNote' in r],
        'nationalValue': next(r['value'] for r in records if r['level'] == 'country'),
        'provinceSum': float(sum(Decimal(str(r['value'])) for r in records if r['level'] == 'province')),
        'notes': ['全国值采用原表，不用省级合计替代。', '未覆盖地区不填零，不借用其他年份。', '名称和父级匹配不等于统计范围与地图边界经过完整核验。'],
    }
    return snapshot, report


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--year', type=int, choices=(2024, 2025), default=2025)
    parser.add_argument('--catalog', type=Path, default=root / 'resources/catalog.json')
    parser.add_argument('--output', type=Path, default=root / 'data/gdp')
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_text(encoding='utf-8'))
    snapshot, report = build(root / 'data/gdp', catalog, args.year)
    args.output.mkdir(parents=True, exist_ok=True)
    for filename, value in [(f'gdp-{args.year}.json', snapshot), (f'coverage-{args.year}.json', report)]:
        (args.output / filename).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'year': snapshot['year'], 'counts': report['counts'], 'total': report['total']}))


if __name__ == '__main__':
    main()
