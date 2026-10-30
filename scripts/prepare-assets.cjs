const fs = require('node:fs');
const path = require('node:path');
const { buildCatalog } = require('./tianditu-catalog.cjs');
const output = path.resolve(__dirname, '../resources');
const aliases = require('../data/legacy-aliases.json');
// Remove retired source notices/reports left by earlier resource builds.
for (const filename of [
  'REGIONS-manifest.json',
  'REGIONS-LICENSE.txt',
  'REGIONS-NOTICE.txt',
  'MAPS-LICENSE.txt',
  'CITY-MAPS-SOURCE-NOTICE.txt',
  'region-links-report.json',
  'tianditu-links-report.json',
]) {
  fs.rmSync(path.join(output, filename), { force: true });
}
fs.mkdirSync(path.join(output, 'maps'), { recursive: true });
fs.mkdirSync(path.join(output, 'vendor'), { recursive: true });
const regions = buildCatalog(path.resolve(__dirname, '../data/tianditu'), output, aliases);
if (new Set(regions.map((region) => region.id)).size !== regions.length)
  throw new Error('行政区标识重复');
fs.writeFileSync(path.join(output, 'catalog.json'), JSON.stringify(regions));
const retained = new Set(regions.flatMap((region) => Object.values(region.variants)));
const mapDirectory = path.join(output, 'maps');
// Delete only obsolete generated JSON files in the fixed maps directory.
for (const entry of fs.readdirSync(mapDirectory, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.json') && !retained.has(entry.name))
    fs.unlinkSync(path.join(mapDirectory, entry.name));
}
fs.copyFileSync(
  require.resolve('echarts/dist/echarts.min.js'),
  path.join(output, 'vendor/echarts.min.js'),
);
fs.copyFileSync(
  require.resolve('echarts/LICENSE'),
  path.join(output, 'vendor/ECHARTS-LICENSE.txt'),
);
fs.copyFileSync(require.resolve('echarts/NOTICE'), path.join(output, 'vendor/ECHARTS-NOTICE.txt'));
fs.copyFileSync(
  path.resolve(__dirname, '../data/tianditu/NOTICE.txt'),
  path.join(output, 'TIANDITU-NOTICE.txt'),
);
console.log(
  JSON.stringify({
    regions: regions.length,
    files: retained.size,
  }),
);
