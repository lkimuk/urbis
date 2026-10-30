// Read the repository's existing map registrations without executing them in Node's global scope.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { appendRegions } = require('./region-catalog.cjs');
const root = path.resolve(__dirname, '../..');
const output = path.resolve(__dirname, '../resources');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry.json'), 'utf8'));
const structure = JSON.parse(fs.readFileSync(path.join(root, 'structure.json'), 'utf8'));
const provinceByName = new Map(
  Object.entries(structure).flatMap(([province, names]) => names.map((name) => [name, province])),
);
fs.mkdirSync(path.join(output, 'maps'), { recursive: true });
fs.mkdirSync(path.join(output, 'vendor'), { recursive: true });
const cities = [];
for (const [name, id] of Object.entries(registry.PINYIN_MAP)) {
  if (name.endsWith('轮廓')) continue;
  const variants = {};
  let districtNames = [];
  for (const [variant, suffix] of [
    ['districts', ''],
    ['outline', '_shape_only'],
  ]) {
    const source = path.join(root, 'js', registry.FILE_MAP[id + suffix] + '.js');
    let registration;
    vm.runInNewContext(
      fs.readFileSync(source, 'utf8'),
      {
        echarts: {
          registerMap: (mapName, geoJSON) => {
            registration = { mapName, geoJSON };
          },
        },
      },
      { filename: source, timeout: 2000 },
    );
    if (!registration?.geoJSON?.features?.length) throw new Error(`地图缺失: ${name}/${variant}`);
    if (variant === 'districts')
      districtNames = registration.geoJSON.features
        .map((feature) => feature.properties?.name)
        .filter(Boolean);
    variants[variant] = `${id}-${variant}.json`;
    fs.writeFileSync(
      path.join(output, 'maps', variants[variant]),
      JSON.stringify(registration.geoJSON),
    );
  }
  const pinyin = id.replace(/[1-5]/g, '').replaceAll('_', '');
  const initials =
    { beijing: 'bj', shanghai: 'sh', tianjin: 'tj', chongqing: 'cq', xianggang: 'xg', aomen: 'am' }[
      id
    ] ||
    id
      .split('_')
      .map((part) => part[0])
      .join('');
  cities.push({
    id,
    name,
    province: provinceByName.get(name) || '直辖市及港澳',
    pinyin,
    initials,
    districtNames,
    variants,
  });
}
cities.sort(
  (a, b) => a.province.localeCompare(b.province, 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'),
);
if (new Set(cities.map((city) => city.id)).size !== cities.length) throw new Error('城市标识重复');
const regions = appendRegions(cities, path.resolve(__dirname, '../data/regions'), output);
if (new Set(regions.map((region) => region.id)).size !== regions.length)
  throw new Error('行政区标识重复');
fs.writeFileSync(path.join(output, 'catalog.json'), JSON.stringify(regions));
fs.copyFileSync(
  require.resolve('echarts/dist/echarts.min.js'),
  path.join(output, 'vendor/echarts.min.js'),
);
fs.copyFileSync(
  require.resolve('echarts/LICENSE'),
  path.join(output, 'vendor/ECHARTS-LICENSE.txt'),
);
fs.copyFileSync(require.resolve('echarts/NOTICE'), path.join(output, 'vendor/ECHARTS-NOTICE.txt'));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(output, 'MAPS-LICENSE.txt'));
console.log(
  `已准备 ${regions.length} 个条目（全国、34 个省级、${cities.length} 个城市）、${regions.length * 2} 份地图和离线 ECharts。`,
);
