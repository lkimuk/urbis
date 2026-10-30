"""Inspect downloaded TianDiTu GeoJSON without changing or importing it.

Requires Python 3.10+ and Shapely 2.x. See data/TIANDITU-AUDIT.md.
"""

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

from shapely import get_coordinates
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.validation import explain_validity


def audit(directory):
    report = {"files": {}, "comparisons": []}
    layers = {}
    for level, filename in [("province", "中国_省.geojson"),
                            ("city", "中国_市.geojson"),
                            ("county", "中国_县.geojson")]:
        raw = (directory / filename).read_bytes()
        data = json.loads(raw.decode("utf-8-sig"))
        if data.get("type") != "FeatureCollection":
            raise ValueError("Expected FeatureCollection: " + filename)
        polygons = []
        issues = []
        types = Counter()
        lines = []
        for index, feature in enumerate(data["features"]):
            properties = feature.get("properties", {})
            geometry = shape(feature["geometry"])
            types[geometry.geom_type] += 1
            label = {"index": index, **properties}
            if geometry.is_empty:
                issues.append({**label, "reason": "empty geometry"})
            if not geometry.is_valid:
                issues.append({**label, "reason": explain_validity(geometry)})
            coordinates = get_coordinates(geometry)
            if any(not math.isfinite(float(value)) for xy in coordinates for value in xy):
                issues.append({**label, "reason": "nonfinite coordinate"})
            if not geometry.is_empty:
                west, south, east, north = geometry.bounds
                if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
                    issues.append({**label, "reason": "coordinates outside geographic envelope"})
            if geometry.geom_type in ("Polygon", "MultiPolygon"):
                code = properties.get("gb", "")
                if not (isinstance(code, str) and len(code) == 9 and
                        code.isdigit() and code.startswith("156")):
                    issues.append({**label, "reason": "unexpected polygon gb code"})
                polygons.append((properties, geometry))
            elif geometry.geom_type in ("LineString", "MultiLineString"):
                lines.append(label)
            else:
                issues.append({**label, "reason": "unexpected geometry type"})
        codes = Counter(properties.get("gb") for properties, _ in polygons)
        report["files"][level] = {
            "filename": filename,
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "metadata": {key: value for key, value in data.items() if key != "features"},
            "features": len(data["features"]),
            "polygons": len(polygons),
            "types": dict(types),
            "lines": lines,
            "issues": issues,
            "duplicatePolygonCodes": [code for code, count in codes.items() if count > 1],
            "regionalCoverage": {
                prefix: [properties for properties, _ in polygons
                         if properties["gb"].startswith("156" + prefix)]
                for prefix in ("71", "81", "82")
            },
        }
        layers[level] = polygons

    for parent_level, child_level in [("province", "city"), ("city", "county")]:
        assigned = Counter()
        for properties, parent in layers[parent_level]:
            code = properties["gb"]
            prefix = code[:5] if code.endswith("0000") else code[:7]
            identical_code = [(p, g) for p, g in layers[child_level] if p["gb"] == code]
            # Municipalities, SARs and province-administered counties can repeat across files.
            children = identical_code or [(p, g) for p, g in layers[child_level]
                                          if p["gb"].startswith(prefix)]
            for child, _ in children:
                assigned[child["gb"]] += 1
            comparison = {"parentLayer": parent_level, "parent": properties,
                          "children": len(children), "sameCodeProxy": bool(identical_code)}
            if children and not parent.is_empty:
                # Never auto-repair geometry. A topology error should fail this operation.
                merged = unary_union([geometry for _, geometry in children])
                area = parent.union(merged).area
                summed = sum(geometry.area for _, geometry in children)
                comparison.update({
                    "symmetricDifferenceRatio": parent.symmetric_difference(merged).area / area if area else 0,
                    "childOverlapRatio": max(0, (summed - merged.area) / summed) if summed else 0,
                    "parentBounds": list(parent.bounds),
                    "childrenBounds": list(merged.bounds),
                })
            report["comparisons"].append(comparison)
        report["files"][child_level]["unassignedCodes"] = [p for p, _ in layers[child_level]
                                                             if not assigned[p["gb"]]]
        report["files"][child_level]["multiplyAssignedCodes"] = [code for code, count in assigned.items()
                                                                   if count > 1]
    report["method"] = {
        "parentAssignment": "gb prefix with exact-code proxy precedence; inferred, not explicit parent metadata",
        "area": "planar longitude/latitude screening, not physical land area",
        "repair": "none",
        "scope": "geometry and inferred hierarchy; not cartographic correctness, current divisions, or data redistribution permission",
    }
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    result = audit(arguments.directory)
    arguments.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + chr(10), encoding="utf-8")
    for level, entry in result["files"].items():
        print(level, entry["polygons"], "polygons;", len(entry["lines"]), "lines;",
              len(entry["issues"]), "issues;", len(entry["duplicatePolygonCodes"]), "duplicate codes")
    comparisons = result["comparisons"]
    print("Comparisons:", len(comparisons), "same-code proxies:", sum(c["sameCodeProxy"] for c in comparisons))
    print("Largest planar difference:", max(c.get("symmetricDifferenceRatio", 0) for c in comparisons))
    failed = any(entry["issues"] or entry["duplicatePolygonCodes"] or
                 entry.get("unassignedCodes") or entry.get("multiplyAssignedCodes")
                 for entry in result["files"].values())
    failed = failed or any(not entry["children"] or entry.get("symmetricDifferenceRatio", 0) > .01 or
                           entry.get("childOverlapRatio", 0) > .001 for entry in comparisons)
    raise SystemExit(1 if failed else 0)
