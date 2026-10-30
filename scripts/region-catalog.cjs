const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const initialsByName = {
  北京: 'bj',
  天津: 'tj',
  河北: 'hb',
  山西: 'sx',
  内蒙古: 'nmg',
  辽宁: 'ln',
  吉林: 'jl',
  黑龙江: 'hlj',
  上海: 'sh',
  江苏: 'js',
  浙江: 'zj',
  安徽: 'ah',
  福建: 'fj',
  江西: 'jx',
  山东: 'sd',
  河南: 'hn',
  湖北: 'hb',
  湖南: 'hn',
  广东: 'gd',
  广西: 'gx',
  海南: 'hn',
  重庆: 'cq',
  四川: 'sc',
  贵州: 'gz',
  云南: 'yn',
  西藏: 'xz',
  陕西: 'sx',
  甘肃: 'gs',
  青海: 'qh',
  宁夏: 'nx',
  新疆: 'xj',
  台湾: 'tw',
  香港: 'xg',
  澳门: 'am',
};

// Match only within a known province. Never guess a replacement for a historical city.
const traditional = {
  臺: '台',
  縣: '县',
  東: '东',
  門: '门',
  連: '连',
  雲: '云',
  園: '园',
  義: '义',
  蘭: '兰',
  蓮: '莲',
};
function matchName(name) {
  return name.replace(/[臺縣東門連雲園義蘭蓮]/g, (char) => traditional[char]).replace(/市$/, '');
}

function appendRegions(cities, source, output) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported region manifest');
  for (const { filename, sha256 } of manifest.files) {
    if (path.basename(filename) !== filename) throw new Error('Invalid region filename');
    const actual = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(source, filename)))
      .digest('hex');
    if (actual !== sha256) throw new Error('Region integrity mismatch: ' + filename);
  }
  const read = (filename) => JSON.parse(fs.readFileSync(path.join(source, filename), 'utf8'));
  const china = read('china.json');
  const country = {
    id: '100000',
    name: '全国',
    level: 'country',
    parentId: null,
    province: '全国',
    pinyin: 'quanguo',
    initials: 'qg',
    districtNames: china.features.map((f) => f.properties.name),
    children: [],
    variants: { districts: '100000-districts.json', outline: '100000-outline.json' },
    source: manifest.version,
  };
  const regions = [country];
  const write = (filename, data) =>
    fs.writeFileSync(path.join(output, 'maps', filename), JSON.stringify(data));
  write(country.variants.districts, china);
  write(country.variants.outline, read('china-contour.json'));
  const unmatched = [];
  for (const feature of china.features) {
    const { id, name } = feature.properties;
    const data = read(id + '.json');
    const province = {
      id,
      name,
      level: 'province',
      parentId: country.id,
      province: name,
      pinyin: path
        .basename(manifest.files.find((file) => file.filename === id + '.json').source, '.json')
        .replace('shanxi1', 'shaanxi'),
      initials: initialsByName[name],
      districtNames: data.features.map((f) => f.properties.name).filter(Boolean),
      children: [],
      variants: { districts: id + '-districts.json', outline: id + '-outline.json' },
      source: manifest.version,
    };
    country.children.push({ name, regionId: id });
    const members = cities.filter(
      (city) => city.province === name || (city.province === '直辖市及港澳' && city.name === name),
    );
    for (const city of members) city.parentId = id;
    // Municipality / SAR maps already show districts; they do not have city-level drilldown.
    if (!['110000', '120000', '310000', '500000', '810000', '820000'].includes(id)) {
      for (const child of data.features) {
        const childName = child.properties?.name;
        const candidates = members.filter(
          (city) => matchName(city.name) === matchName(childName || ''),
        );
        if (candidates.length === 1)
          province.children.push({ name: childName, regionId: candidates[0].id });
        else
          unmatched.push({
            province: name,
            feature: childName,
            reason: candidates.length ? 'ambiguous' : 'no historical city match',
          });
      }
    }
    write(province.variants.districts, data);
    // Keep the upstream encoded coordinates and offsets intact.
    write(province.variants.outline, { ...china, features: [feature] });
    regions.push(province);
  }
  for (const city of cities) {
    if (!city.parentId) throw new Error('City has no province: ' + city.name);
    Object.assign(city, {
      level: 'city',
      children: [],
      source: 'echarts-china-cities-js (historical)',
    });
  }
  for (const filename of ['manifest.json', 'LICENSE.txt', 'NOTICE.txt']) {
    fs.copyFileSync(path.join(source, filename), path.join(output, 'REGIONS-' + filename));
  }
  fs.writeFileSync(
    path.join(output, 'region-links-report.json'),
    JSON.stringify({ unmatched }, null, 2),
  );
  return [...regions, ...cities];
}

module.exports = { appendRegions, matchName };
