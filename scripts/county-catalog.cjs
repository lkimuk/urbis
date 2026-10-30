const fs = require('node:fs');
const path = require('node:path');

// Preserve existing city geometry, including encoded coordinates and offsets.
function appendCounties(regions, output) {
  const counties = [];
  const byId = new Map(regions.map((region) => [region.id, region]));
  for (const city of regions.filter((region) => region.level === 'city')) {
    const data = JSON.parse(
      fs.readFileSync(path.join(output, 'maps', city.variants.districts), 'utf8'),
    );
    const names = new Set();
    for (const feature of data.features) {
      const name = feature.properties?.name;
      if (!name || names.has(name) || !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type))
        throw new Error('Invalid or duplicate county feature: ' + city.name + '/' + name);
      names.add(name);
      // Namespaced by parent and full UTF-8 name, stable across feature reordering.
      const id = city.id + '--' + Buffer.from(name).toString('hex');
      const filename = id + '.json';
      const province = byId.get(city.parentId);
      const county = {
        id,
        name,
        level: 'county',
        parentId: city.id,
        province: city.province,
        city: city.name,
        pinyin: '',
        initials: '',
        districtNames: [name],
        children: [],
        source: city.source,
        variants: { districts: filename, outline: filename },
      };
      fs.writeFileSync(
        path.join(output, 'maps', filename),
        JSON.stringify({ ...data, features: [feature] }),
      );
      city.children.push({ name, regionId: id });
      // Municipality and SAR province maps show counties directly.
      if (
        ['110000', '120000', '310000', '500000', '810000', '820000'].includes(province.id) &&
        province.districtNames.includes(name)
      )
        province.children.push({ name, regionId: id });
      counties.push(county);
    }
  }
  return [...regions, ...counties];
}

module.exports = { appendCounties };
