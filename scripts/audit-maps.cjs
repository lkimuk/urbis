// Check the generated offline library against its source, before ECharts mutates coordinates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const echarts = require('echarts');

const root = path.resolve(__dirname, '../..');
const resources = path.join(root, 'desktop/resources');
const read = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));
const catalog = read(path.join(resources, 'catalog.json'));
const registry = read(path.join(root, 'registry.json'));
const byId = new Map(catalog.map((region) => [region.id, region]));
assert.equal(byId.size, catalog.length, 'Duplicate region ID');
const maps = new Map();
function load(filename) {
  assert.equal(path.basename(filename), filename, 'Invalid map filename');
  if (!maps.has(filename)) maps.set(filename, read(path.join(resources, 'maps', filename)));
  return maps.get(filename);
}

const levels = { country: 0, province: 1, city: 2, county: 3 };
const counts = { country: 0, province: 0, city: 0, county: 0 };
let variants = 0;
for (const region of catalog) {
  assert.ok(Object.hasOwn(levels, region.level), region.id);
  counts[region.level]++;
  if (region.level === 'country') assert.equal(region.parentId, null);
  else {
    const parent = byId.get(region.parentId);
    assert.ok(parent, 'Missing parent: ' + region.id);
    assert.equal(levels[parent.level] + 1, levels[region.level], region.id);
  }
  assert.equal(new Set(region.districtNames).size, region.districtNames.length, region.id);
  assert.equal(
    new Set(region.children.map((child) => child.name)).size,
    region.children.length,
    region.id,
  );
  assert.equal(
    new Set(region.children.map((child) => child.regionId)).size,
    region.children.length,
    region.id,
  );
  for (const child of region.children) {
    assert.ok(region.districtNames.includes(child.name), region.id + '/' + child.name);
    const target = byId.get(child.regionId);
    assert.ok(target, 'Missing child: ' + child.regionId);
    // Municipality / SAR maps may bypass the retained city entry.
    assert.ok(
      target.parentId === region.id ||
        (region.level === 'province' &&
          target.level === 'county' &&
          byId.get(target.parentId)?.parentId === region.id),
      region.id + '/' + child.regionId,
    );
  }
  for (const variant of ['districts', 'outline']) {
    const data = load(region.variants[variant]);
    assert.ok(data.features?.length, region.id + '/' + variant);
    if (variant === 'districts')
      assert.deepEqual(
        data.features.map((feature) => feature.properties.name),
        region.districtNames,
        region.id,
      );
    variants++;
  }
  if (region.level === 'city') {
    for (const [variant, suffix] of [
      ['districts', ''],
      ['outline', '_shape_only'],
    ]) {
      const source = path.join(root, 'js', registry.FILE_MAP[region.id + suffix] + '.js');
      let original;
      vm.runInNewContext(
        fs.readFileSync(source, 'utf8'),
        {
          echarts: {
            registerMap: (_, data) => {
              original = data;
            },
          },
        },
        { filename: source, timeout: 2000 },
      );
      assert.deepEqual(
        load(region.variants[variant]),
        JSON.parse(JSON.stringify(original)),
        'City source changed: ' + region.id + '/' + variant,
      );
    }
    assert.equal(region.children.length, region.districtNames.length, region.id);
  }
  if (region.level === 'county') {
    const city = byId.get(region.parentId);
    const original = load(city.variants.districts);
    const features = original.features.filter((feature) => feature.properties.name === region.name);
    assert.equal(features.length, 1, region.id);
    assert.deepEqual(
      load(region.variants.districts),
      { ...original, features },
      'County extraction changed: ' + region.id,
    );
    assert.equal(region.variants.districts, region.variants.outline, region.id);
    assert.ok(
      city.children.some((child) => child.regionId === region.id && child.name === region.name),
      region.id,
    );
    assert.equal(region.children.length, 0, region.id);
  }
}

let features = 0;
for (const [filename, original] of maps) {
  const names = original.features.map((feature) => feature.properties?.name);
  assert.ok(
    names.every((name) => typeof name === 'string' && name.length),
    filename,
  );
  assert.equal(new Set(names).size, names.length, 'Duplicate feature name: ' + filename);
  const data = structuredClone(original);
  const parsed = echarts.parseGeoJSON(data); // Decodes UTF8 coordinates in place.
  assert.equal(parsed.length, data.features.length, 'ECharts skipped a feature: ' + filename);
  for (const feature of data.features) {
    const geometry = feature.geometry;
    assert.ok(['Polygon', 'MultiPolygon'].includes(geometry?.type), filename);
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    assert.ok(polygons.length, 'Empty polygon: ' + filename);
    let positions = 0;
    for (const polygon of polygons) {
      assert.ok(polygon.length, 'Empty ring list: ' + filename);
      for (const ring of polygon) {
        assert.ok(Array.isArray(ring) && ring.length, 'Empty ring: ' + filename);
        for (const point of ring) {
          assert.ok(
            Array.isArray(point) && point.length === 2 && point.every(Number.isFinite),
            filename,
          );
          assert.ok(
            point[0] >= 60 && point[0] <= 150 && point[1] >= -5 && point[1] <= 60,
            'Coordinate outside expected envelope: ' + filename,
          );
          positions++;
        }
      }
    }
    assert.ok(positions, filename);
    features++;
  }
  for (const part of parsed) {
    const box = part.getBoundingRect();
    assert.ok([box.x, box.y, box.width, box.height].every(Number.isFinite), filename);
    assert.ok(box.width > 0 && box.height > 0, 'Empty bounds: ' + filename);
  }
}
console.log(
  JSON.stringify(
    {
      counts,
      variants,
      files: maps.size,
      features,
      checks: [
        'hierarchy and links',
        'source city equality',
        'lossless county extraction',
        'feature names',
        'decoded coordinates and bounds',
      ],
      scope:
        'Structural integrity only; does not certify topology, boundary agreement, current administrative divisions, or cartographic compliance.',
    },
    null,
    2,
  ),
);
