// Import only a verified, already downloaded upstream release. Never used at app runtime.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const archive = path.resolve(process.argv[2] || 'artifacts/echarts-4.8.0.tgz');
const integrity =
  'YwShpug8fWngj/RlgxDaYrLBoD+LsZUArrusjNPHpAF+is+gGe38xx4W848AwWMGoi745t3OXM52JedNrv+F6g==';
if (crypto.createHash('sha512').update(fs.readFileSync(archive)).digest('base64') !== integrity)
  throw new Error('ECharts 4.8.0 archive integrity mismatch');
const output = path.resolve(__dirname, '../data/regions');
fs.mkdirSync(output, { recursive: true });
const entries = [];
function extract(source, filename) {
  const bytes = execFileSync('tar', ['-xOzf', archive, 'package/' + source], {
    maxBuffer: 16 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(output, filename), bytes);
  entries.push({
    filename,
    source,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
  return bytes;
}
const china = JSON.parse(extract('map/json/china.json', 'china.json'));
extract('map/json/china-contour.json', 'china-contour.json');
const slugs = {
  北京: 'beijing',
  天津: 'tianjin',
  河北: 'hebei',
  山西: 'shanxi',
  内蒙古: 'neimenggu',
  辽宁: 'liaoning',
  吉林: 'jilin',
  黑龙江: 'heilongjiang',
  上海: 'shanghai',
  江苏: 'jiangsu',
  浙江: 'zhejiang',
  安徽: 'anhui',
  福建: 'fujian',
  江西: 'jiangxi',
  山东: 'shandong',
  河南: 'henan',
  湖北: 'hubei',
  湖南: 'hunan',
  广东: 'guangdong',
  广西: 'guangxi',
  海南: 'hainan',
  重庆: 'chongqing',
  四川: 'sichuan',
  贵州: 'guizhou',
  云南: 'yunnan',
  西藏: 'xizang',
  陕西: 'shanxi1',
  甘肃: 'gansu',
  青海: 'qinghai',
  宁夏: 'ningxia',
  新疆: 'xinjiang',
  台湾: 'taiwan',
  香港: 'xianggang',
  澳门: 'aomen',
};
for (const { properties } of china.features) {
  if (!slugs[properties.name]) throw new Error('Unknown province: ' + properties.name);
  extract('map/json/province/' + slugs[properties.name] + '.json', properties.id + '.json');
}
extract('LICENSE', 'LICENSE.txt');
extract('NOTICE', 'NOTICE.txt');
fs.writeFileSync(
  path.join(output, 'manifest.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      source: 'https://registry.npmjs.org/echarts/-/echarts-4.8.0.tgz',
      version: 'echarts@4.8.0',
      archiveIntegrity: 'sha512-' + integrity,
      importedAt: new Date().toISOString(),
      license: 'Apache-2.0; see LICENSE.txt and NOTICE.txt from the upstream distribution',
      note: 'Historical upstream map snapshot; not a current administrative division database. Files are copied unchanged.',
      files: entries,
    },
    null,
    2,
  ),
);
console.log('Imported national maps and ' + china.features.length + ' province maps.');
