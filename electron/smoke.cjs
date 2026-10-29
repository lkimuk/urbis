const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { nativeImage } = require('electron');
exports.run = async function run(window, app) {
  const output = path.join(app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..'), 'artifacts');
  await fs.mkdir(output, { recursive: true });
  const errors = [];
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const js = code => window.webContents.executeJavaScript(code);
  await js('window.atlasReady');
  assert.equal(await js('cities.length'), 392);
  assert.equal(await js(`document.querySelectorAll('.city-button').length`), 392);
  assert.equal(await js(`document.getElementById('map-message').hidden`), true);
  assert.equal(await js('typeof require'), 'undefined');
  console.log('PASS: 392 cities, initial map, isolated renderer');
  await fs.writeFile(path.join(output, 'workbench.png'), (await window.webContents.capturePage()).toPNG());
  for (const query of ['nanchang', 'nc', '南昌', '台北']) {
    const count = await js(`$('search').value = ${JSON.stringify(query)}; renderList(); document.querySelectorAll('.city-button').length`);
    assert.ok(count > 0, `Search failed: ${query}`);
  }
  assert.equal(await js(`$('search').value = '不存在的城市'; renderList(); document.querySelectorAll('.city-button').length`), 0);
  assert.equal(await js(`$('search').value = ''; $('province').value = '江西'; renderList(); document.querySelectorAll('.city-button').length`), 11);
  await js(`$('province').value = ''; renderList()`);
  console.log('PASS: Chinese, pinyin, initials, traditional aliases, province, empty results');
  const validated = await js(`(async () => {
    let count = 0;
    for (const city of cities) for (const variant of ['districts', 'outline']) {
      const data = await window.atlas.getMap(city.id, variant);
      const key = city.id + '-' + variant; echarts.registerMap(key, data);
      echarts.parseGeoJSON(data);
      const map = echarts.getMap(key).geoJSON;
      if (!map.features.length) throw new Error(key + ' is empty');
      const inspect = value => {
        if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error(key + ' invalid coordinate'); }
        else if (Array.isArray(value)) value.forEach(inspect);
        else throw new Error(key + ' undecoded coordinate');
      };
      map.features.forEach(feature => inspect(feature.geometry.coordinates)); count++;
    } return count;
  })()`);
  assert.equal(validated, 784);
  console.log('PASS: all 784 offline maps loaded and decoded');
  for (const name of ['北京', '南昌', '臺北', '香港', '乌鲁木齐', '海口']) {
    for (const variant of ['districts', 'outline']) {
      const result = await js(`(async () => { state.variant = ${JSON.stringify(variant)}; syncControls(); await selectCity(cities.find(c => c.name === ${JSON.stringify(name)})); return { hidden: $('map-message').hidden, map: chart.getOption().series[0].map, shapes: chart.getZr().storage.getDisplayList().length }; })()`);
      assert.ok(result.hidden && result.shapes > 0, `${name}/${variant} failed to render`);
    }
  }
  assert.equal(await js(`(async () => { await Promise.all([selectCity(cities.find(c => c.name === '北京')), selectCity(cities.find(c => c.name === '南昌')), selectCity(cities.find(c => c.name === '臺北'))]); return chart.getOption().series[0].map === currentCity.id + '-' + state.variant; })()`), true);
  assert.equal(await js(`(async () => { try { await window.atlas.getMap('../package', 'districts'); return false; } catch { return true; } })()`), true);
  console.log('PASS: rendering both modes, rapid city changes, invalid IPC input');
  await js(`state.variant = 'districts'; state.transparent = false; state.scale = 2; Object.assign(state, palettes.clay, {palette:'clay'}); syncControls(); selectCity(cities.find(c => c.name === '北京'))`);
  await js(`$('map-title').value = '北京 · 城市图志'; updateChart(); zoom(1.25)`);
  const image = await js('exportImage()');
  assert.ok(!image.canceled && image.size.width > 500 && image.size.height > 500);
  assert.equal(nativeImage.createFromPath(image.filePath).toBitmap()[3], 255, 'Opaque export should retain background');
  await js(`state.transparent = true; syncControls(); updateChart()`);
  const transparent = await js('exportImage()');
  assert.equal(nativeImage.createFromPath(transparent.filePath).toBitmap()[3], 0, 'Transparent export should retain alpha');
  await js(`state.transparent = false; state.variant = 'outline'; syncControls(); loadMap()`);
  await fs.writeFile(path.join(output, 'outline.png'), (await window.webContents.capturePage()).toPNG());
  assert.ok(await js(`JSON.parse(localStorage.getItem('city-atlas')).cityId`));
  await fs.writeFile(path.join(output, 'smoke-report.json'), JSON.stringify({ cities: 392, maps: validated, image: image.size, checks: ['search', 'filter', 'render', 'rapid changes', 'IPC validation', 'opaque PNG', 'transparent PNG', 'preferences'], errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log('PASS: 2x PNG, transparency, preferences; screenshots in desktop/artifacts');
};
