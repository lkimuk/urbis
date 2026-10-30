const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const clipping = require('polygon-clipping');
const { pinyin } = require('pinyin-pro');

function readSnapshot(source) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.crs !== 'EPSG:4490')
    throw Error('Unsupported Tianditu snapshot');
  const layers = {};
  for (const file of manifest.files) {
    if (path.basename(file.filename) !== file.filename) throw Error('Invalid snapshot filename');
    const raw = fs.readFileSync(path.join(source, file.filename));
    if (crypto.createHash('sha256').update(raw).digest('hex') !== file.sha256)
      throw Error('Tianditu integrity mismatch: ' + file.filename);
    const data = JSON.parse(raw.toString('utf8'));
    const polygons = data.features.filter((f) =>
      ['Polygon', 'MultiPolygon'].includes(f.geometry?.type),
    );
    const lines = data.features.filter((f) =>
      ['LineString', 'MultiLineString'].includes(f.geometry?.type),
    );
    if (
      polygons.length + lines.length !== data.features.length ||
      new Set(polygons.map((f) => f.properties.gb)).size !== polygons.length ||
      polygons.some((f) => !/^156[0-9]{6}$/.test(f.properties.gb))
    )
      throw Error('Invalid Tianditu layer: ' + file.filename);
    layers[file.filename.split('.')[0]] = { data, polygons, lines };
  }
  return { manifest, layers };
}

const provinceName = (name) =>
  name.replace(/省$|市$|特别行政区$|壮族自治区$|回族自治区$|维吾尔自治区$|自治区$/g, '');
const coordinates = (feature) =>
  feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates;

// Liang-Barsky clipping retains original line segments, clipped only to the map envelope.
function clipLines(features, box) {
  const result = [];
  for (const feature of features)
    for (const line of feature.geometry.type === 'LineString'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates) {
      let current = [];
      const flush = () => {
        if (current.length > 1) result.push(current);
        current = [];
      };
      for (let i = 1; i < line.length; i++) {
        const [x, y] = line[i - 1],
          dx = line[i][0] - x,
          dy = line[i][1] - y;
        let start = 0,
          end = 1,
          visible = true;
        const p = [-dx, dx, -dy, dy],
          q = [x - box[0], box[2] - x, y - box[1], box[3] - y];
        for (let j = 0; j < 4; j++) {
          if (p[j] === 0) {
            if (q[j] < 0) visible = false;
          } else if (p[j] < 0) start = Math.max(start, q[j] / p[j]);
          else end = Math.min(end, q[j] / p[j]);
        }
        if (!visible || start > end) {
          flush();
          continue;
        }
        const a = [x + start * dx, y + start * dy],
          b = [x + end * dx, y + end * dy];
        if (current.length && (current.at(-1)[0] !== a[0] || current.at(-1)[1] !== a[1])) flush();
        if (!current.length) current.push(a);
        current.push(b);
      }
      flush();
    }
  return result;
}

function buildCatalog(source, output, aliasesById) {
  const { manifest, layers } = readSnapshot(source);
  const catalog = [];
  const write = (filename, value) =>
    fs.writeFileSync(path.join(output, 'maps', filename), JSON.stringify(value));
  const searchFields = (name) => ({
    pinyin:
      name === '陕西' ? 'shaanxi' : pinyin(name, { toneType: 'none', type: 'array' }).join(''),
    initials: pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' }).join(''),
  });
  function build(feature, level, parent, members, lineFeatures, forcedId) {
    if (!members.length) throw Error('Empty map: ' + feature.properties.gb);
    const name =
      level === 'province' ? provinceName(feature.properties.name) : feature.properties.name;
    const id = forcedId || 'tdt-' + feature.properties.gb.slice(3);
    const region = {
      id,
      name,
      level,
      parentId: parent?.id || null,
      province: level === 'province' ? name : parent?.province || '全国',
      city: level === 'county' ? parent.name : '',
      ...searchFields(name),
      aliases: aliasesById[id] || [],
      children: [],
      districtNames: members.map((f) => f.properties.name),
      source: '天地图 · 2026-10 下载',
      crs: manifest.crs,
      sourceId: feature.properties.gb || '156000000',
      variants: { districts: id + '-districts.json', outline: id + '-outline.json' },
    };
    // Derive outline from exactly the displayed districts, never the old shape_only files.
    const merged =
      members.length === 1 ? coordinates(members[0]) : clipping.union(...members.map(coordinates));
    const outline = {
      type: 'Feature',
      properties: { name },
      geometry: { type: 'MultiPolygon', coordinates: merged },
    };
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of merged)
      for (const ring of poly)
        for (const [x, y] of ring) {
          box[0] = Math.min(box[0], x);
          box[1] = Math.min(box[1], y);
          box[2] = Math.max(box[2], x);
          box[3] = Math.max(box[3], y);
        }
    const boundaryLines =
      level === 'country'
        ? lineFeatures.flatMap((feature) =>
            feature.geometry.type === 'LineString'
              ? [feature.geometry.coordinates]
              : feature.geometry.coordinates,
          )
        : clipLines(lineFeatures, box);
    const data = {
      type: 'FeatureCollection',
      crs: layers.provinces.data.crs,
      boundaryLines,
      features: members,
    };
    write(region.variants.districts, data);
    write(region.variants.outline, { ...data, features: [outline] });
    catalog.push(region);
    return region;
  }
  const country = build(
    { properties: { name: '全国', gb: '156000000' } },
    'country',
    null,
    layers.provinces.polygons,
    layers.provinces.lines,
    '100000',
  );
  const provinces = new Map();
  for (const feature of layers.provinces.polygons) {
    const code = feature.properties.gb;
    let cities = layers.cities.polygons.filter((f) => f.properties.gb.startsWith(code.slice(0, 5)));
    const same = cities.find((f) => f.properties.gb === code);
    if (same)
      cities = layers.counties.polygons.filter((f) => f.properties.gb.startsWith(code.slice(0, 5)));
    const province = build(
      feature,
      'province',
      country,
      cities,
      same ? layers.counties.lines : layers.cities.lines,
      code.slice(3),
    );
    province.province = province.name;
    country.children.push({ name: feature.properties.name, regionId: province.id });
    provinces.set(code, province);
  }
  for (const feature of layers.cities.polygons) {
    const code = feature.properties.gb,
      province = provinces.get(code.slice(0, 5) + '0000');
    if (!province) throw Error('Missing province: ' + code);
    if (provinces.has(code)) continue; // direct province -> county for municipalities, SARs, Taiwan
    const exact = layers.counties.polygons.find((f) => f.properties.gb === code);
    const members = exact
      ? [exact]
      : layers.counties.polygons.filter((f) => f.properties.gb.startsWith(code.slice(0, 7)));
    if (!members.length) throw Error('Missing county geometry: ' + code);
    const city = build(feature, 'city', province, members, layers.counties.lines);
    province.children.push({ name: feature.properties.name, regionId: city.id });
  }
  for (const feature of layers.counties.polygons) {
    const code = feature.properties.gb,
      province = provinces.get(code.slice(0, 5) + '0000');
    const city = catalog.find(
      (r) => r.level === 'city' && (r.sourceId === code || r.sourceId === code.slice(0, 7) + '00'),
    );
    const parent = city || province;
    if (!parent || !parent.districtNames.includes(feature.properties.name))
      throw Error('Unlinked county: ' + code);
    const county = build(
      feature,
      'county',
      parent,
      [feature],
      layers.counties.lines,
      'tdt-county-' + code.slice(3),
    );
    if (parent.level === 'province') county.city = parent.name;
    parent.children.push({ name: feature.properties.name, regionId: county.id });
  }
  fs.copyFileSync(path.join(source, 'manifest.json'), path.join(output, 'TIANDITU-manifest.json'));
  const ids = new Set(catalog.map((region) => region.id));
  for (const id of Object.keys(aliasesById))
    if (!ids.has(id)) throw Error('Alias target missing: ' + id);
  const rank = { country: 0, province: 1, city: 2, county: 3 };
  catalog.sort(
    (a, b) =>
      rank[a.level] - rank[b.level] ||
      a.province.localeCompare(b.province, 'zh-CN') ||
      (a.city || '').localeCompare(b.city || '', 'zh-CN') ||
      a.name.localeCompare(b.name, 'zh-CN'),
  );
  return catalog;
}
module.exports = { buildCatalog, readSnapshot, clipLines };
