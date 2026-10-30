const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const echarts = require('echarts');
const clipping = require('polygon-clipping');
const { readSnapshot } = require('./tianditu-catalog.cjs');
const resources = path.resolve(__dirname, '../resources');
const catalog = JSON.parse(fs.readFileSync(path.join(resources, 'catalog.json')));
const { layers } = readSnapshot(path.resolve(__dirname, '../data/tianditu'));
const originals = new Map(
  Object.values(layers)
    .flatMap((layer) => layer.polygons)
    .map((feature) => [feature.properties.gb, feature]),
);
const byId = new Map(catalog.map((region) => [region.id, region]));
assert.equal(byId.size, catalog.length);
const files = new Map(),
  aliases = new Set();
const load = (filename) => {
  assert.equal(path.basename(filename), filename);
  if (!files.has(filename))
    files.set(filename, JSON.parse(fs.readFileSync(path.join(resources, 'maps', filename))));
  return files.get(filename);
};
for (const region of catalog) {
  if (region.parentId) assert.ok(byId.has(region.parentId), region.id);
  assert.equal(new Set(region.districtNames).size, region.districtNames.length, region.id);
  assert.equal(
    new Set(region.children.map((child) => child.name)).size,
    region.children.length,
    region.id,
  );
  for (const alias of region.aliases || []) {
    assert.ok(!aliases.has(alias), 'Duplicate alias ' + alias);
    aliases.add(alias);
  }
  for (const child of region.children) {
    const target = byId.get(child.regionId);
    assert.ok(target, region.id);
    assert.equal(target.parentId, region.id, region.id);
    assert.ok(region.districtNames.includes(child.name), region.id);
  }
  const districts = load(region.variants.districts),
    outline = load(region.variants.outline);
  assert.deepEqual(
    districts.features.map((feature) => feature.properties.name),
    region.districtNames,
    region.id,
  );
  for (const feature of districts.features)
    assert.deepEqual(feature, originals.get(feature.properties.gb), region.id);
  const polygons = districts.features.map((feature) =>
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates,
  );
  const expected = polygons.length === 1 ? polygons[0] : clipping.union(...polygons);
  assert.deepEqual(
    outline.features[0].geometry,
    { type: 'MultiPolygon', coordinates: expected },
    region.id,
  );
  assert.deepEqual(outline.boundaryLines, districts.boundaryLines, region.id);
}
for (const [filename, original] of files) {
  const data = structuredClone(original),
    parsed = echarts.parseGeoJSON(data);
  assert.equal(parsed.length, data.features.length, filename);
  for (const part of parsed) {
    const b = part.getBoundingRect();
    assert.ok([b.x, b.y, b.width, b.height].every(Number.isFinite), filename);
    assert.ok(b.width > 0 && b.height > 0, filename);
  }
  for (const line of data.boundaryLines || []) {
    assert.ok(line.length >= 2, filename);
    for (const xy of line) assert.ok(xy.length === 2 && xy.every(Number.isFinite), filename);
  }
}
assert.equal(
  fs.readdirSync(path.join(resources, 'maps')).filter((name) => name.endsWith('.json')).length,
  files.size,
  'Obsolete map files',
);
console.log(
  JSON.stringify(
    {
      regions: catalog.length,
      modes: catalog.length * 2,
      files: files.size,
      aliases: aliases.size,
      checks: [
        'source integrity',
        'lossless display features',
        'outline union equality',
        'hierarchy',
        'aliases',
        'decoded bounds',
        'boundary lines',
        'no obsolete maps',
      ],
    },
    null,
    2,
  ),
);
