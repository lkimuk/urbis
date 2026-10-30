"""Independently check generated primary maps using Shapely 2.x (maintenance only)."""

import argparse
import json
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.validation import explain_validity


def audit(resources):
    catalog = json.loads((resources / 'catalog.json').read_text(encoding='utf-8'))
    failures = []
    checked = 0
    maximum = 0
    for region in catalog:
        geometries = {}
        for variant, filename in region['variants'].items():
            data = json.loads((resources / 'maps' / filename).read_text(encoding='utf-8'))
            parts = [shape(feature['geometry']) for feature in data['features']]
            for index, part in enumerate(parts):
                if part.is_empty or not part.is_valid:
                    failures.append({'id': region['id'], 'variant': variant,
                                     'feature': index, 'issue': explain_validity(part)})
            geometries[variant] = unary_union(parts)
        districts, outline = geometries['districts'], geometries['outline']
        area = districts.union(outline).area
        difference = districts.symmetric_difference(outline).area / area if area else 1
        maximum = max(maximum, difference)
        if difference > 1e-10:
            failures.append({'id': region['id'], 'differenceRatio': difference})
        checked += 1
    return {'maps': checked, 'modes': checked * 2,
            'maximumDifferenceRatio': maximum, 'failures': failures,
            'method': 'Shapely validity and planar union comparison; no repair or simplification'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('resources', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.resources)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
    raise SystemExit(1 if report['failures'] or not report['maps'] else 0)
