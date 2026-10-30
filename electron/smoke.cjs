const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { nativeImage } = require('electron');

// Exercise DOM events and the public bridge. Do not reach into renderer module state.
exports.run = async function run(window, output) {
  await fs.mkdir(output, { recursive: true });
  const errors = [];
  const networkRequests = [];
  window.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      networkRequests.push(details.url);
      callback({ cancel: true });
    },
  );
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message);
  });
  const js = async (code) => {
    try {
      return await window.webContents.executeJavaScript(
        '(async () => { const {createAtlasClient} = await import("./desktop-api.mjs"); const atlas = createAtlasClient(window.atlas); return (' +
          code.replaceAll('window.atlas', 'atlas') +
          '); })()',
      );
    } catch (error) {
      throw new Error('Renderer execution failed: ' + code, { cause: error });
    }
  };
  async function waitFor(expression) {
    const deadline = Date.now() + 15000;
    while (!(await js(expression))) {
      if (Date.now() > deadline) throw new Error('Timed out: ' + expression);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  async function input(id, value, event = 'input') {
    await js(
      '(() => { const el = document.getElementById(' +
        JSON.stringify(id) +
        '); el.value = ' +
        JSON.stringify(value) +
        '; el.dispatchEvent(new Event(' +
        JSON.stringify(event) +
        ', {bubbles:true})); })()',
    );
  }
  async function click(selector) {
    await js('document.querySelector(' + JSON.stringify(selector) + ').click()');
  }
  async function screenshot(filename) {
    await window.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await fs.writeFile(
      path.join(output, filename),
      (await window.webContents.capturePage()).toPNG(),
    );
  }
  async function select(name, variant) {
    await input('search', name);
    await click('.city-button');
    if (variant) await click('[name=variant][value=' + variant + ']');
    await waitFor('document.getElementById("map").dataset.ready === "true"');
    assert.equal(await js('document.querySelector(".city-button.active span").textContent'), name);
    assert.equal(
      await js(
        'document.getElementById("map").dataset.mapKey.endsWith(' +
          JSON.stringify('-' + (variant || 'districts')) +
          ')',
      ),
      true,
    );
  }
  async function exportPng(transparent) {
    await js(
      '(() => { document.getElementById("transparent").checked = ' +
        transparent +
        '; document.getElementById("transparent").dispatchEvent(new Event("change")); })()',
    );
    await click('#export');
    await waitFor(
      '!document.getElementById("export").disabled && !document.getElementById("toast").hidden',
    );
    const message = await js('document.getElementById("toast").textContent');
    assert.ok(message.startsWith('已保存'), message);
    const filename = transparent ? 'transparent.png' : 'opaque.png';
    const regionName = await js('document.querySelector("#breadcrumb [aria-current]").textContent');
    const actual = path.join(output, regionName + '-行政区地图.png');
    const image = nativeImage.createFromPath(actual);
    const size = image.getSize();
    assert.equal(image.toBitmap()[3], transparent ? 0 : 255);
    await fs.copyFile(actual, path.join(output, filename));
    return size;
  }

  await waitFor('document.getElementById("map").dataset.ready === "true"');
  assert.equal(await js('document.querySelectorAll(".city-button").length'), 3680);
  assert.equal(await js('typeof require'), 'undefined');
  assert.equal(await js('typeof currentRegion'), 'undefined');
  const cities = await js('window.atlas.getRegions()');
  assert.equal(cities.length, 3680);
  assert.equal(cities.filter((region) => region.level === 'county').length, 3253);
  assert.equal(cities.filter((region) => region.level === 'province').length, 34);
  assert.ok(cities.every((city) => !Object.hasOwn(city, 'variants')));
  await screenshot('workbench.png');
  console.log('PASS: initial map, isolated modules, catalog without filesystem paths');

  for (const query of ['nanchang', 'nc', '南昌', '台北', 'bj', 'jiangxi', 'jx', 'shaanxi']) {
    await input('search', query);
    assert.ok(await js('document.querySelectorAll(".city-button").length > 0'), query);
  }
  await input('search', '不存在的城市');
  assert.equal(await js('document.querySelectorAll(".city-button").length'), 0);
  await input('search', '');
  await input('province', '江西', 'change');
  assert.equal(await js('document.querySelectorAll(".city-button").length'), 112);
  await input('province', '', 'change');

  const validated = await js(
    '(async () => { let count = 0; for (const city of await window.atlas.getRegions()) for (const variant of ["districts", "outline"]) { const data = await window.atlas.getMap({regionId:city.id,variant}); const regions = echarts.parseGeoJSON(data); if (!regions.length) throw Error(city.id); for (const region of regions) { const b = region.getBoundingRect(); if (![b.x,b.y,b.width,b.height].every(Number.isFinite)) throw Error(city.id); } count++; } return count; })()',
  );
  assert.equal(validated, 7360);
  const invalid = await js(
    '(async () => { try { await window.atlas.getMap({regionId:"../package",variant:"districts"}); return null; } catch(e) { return {message:e.message,code:e.code}; } })()',
  );
  assert.equal(invalid.message, '未找到对应地图');
  assert.equal(invalid.code, 'MAP_NOT_FOUND');
  const badImage = await js(
    '(async () => { try { await window.atlas.saveImage({dataURL:"data:image/png;base64,aGVsbG8="}); return false; } catch(e) { return e.code === "INVALID_IMAGE"; } })()',
  );
  assert.equal(badImage, true);
  console.log('PASS: search, province filters, all 7360 map variants, API error contracts');

  for (const name of ['北京', '南昌', '臺北', '香港', '乌鲁木齐', '海口']) {
    await input('level', 'city', 'change');
    await select(name, 'districts');
    await select(name, 'outline');
  }
  await input('search', '');
  await input('level', '', 'change');
  await select('全国', 'districts');
  async function clickMapRegion(name) {
    const point = await js(
      '(() => { const el = document.getElementById("map"); const chart = echarts.getInstanceByDom(el); const option = chart.getOption(); const geo = echarts.getMap(option.series[0].map).geoJSON; const feature = geo.features.find(f => f.properties.name === ' +
        JSON.stringify(name) +
        '); const xy = chart.convertToPixel({seriesIndex:0}, feature.properties.cp); const rect = el.getBoundingClientRect(); return {x:Math.round(rect.left+xy[0]), y:Math.round(rect.top+xy[1])}; })()',
    );
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      ...point,
    });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  }
  await clickMapRegion('江西');
  await waitFor(
    'document.getElementById("map").dataset.mapKey === "360000-districts" && document.getElementById("map").dataset.ready === "true"',
  );
  await screenshot('province.png');
  await exportPng(false);
  await clickMapRegion('南昌市');
  await waitFor(
    'document.getElementById("map").dataset.mapKey === "nan2_chang1-districts" && document.getElementById("map").dataset.ready === "true"',
  );
  const eastLake = cities.find(
    (region) =>
      region.level === 'county' && region.parentId === 'nan2_chang1' && region.name === '东湖区',
  );
  await clickMapRegion('东湖区');
  await waitFor(
    'document.getElementById("map").dataset.mapKey === ' +
      JSON.stringify(eastLake.id + '-districts') +
      ' && document.getElementById("map").dataset.ready === "true"',
  );
  assert.equal(await js('document.querySelectorAll("#breadcrumb button").length'), 4);
  await input('search', '');
  await screenshot('county.png');
  await exportPng(false);
  await input('level', 'county', 'change');
  await input('search', '东湖区');
  assert.equal(await js('document.querySelectorAll(".city-button").length'), 1);
  await select('东湖区', 'outline');
  await input('level', 'city', 'change');
  await select('臺北', 'districts');
  const taipeiCounty = cities.find(
    (region) => region.level === 'county' && region.parentId === 'tai2_bei3',
  );
  await input('level', 'county', 'change');
  await select(taipeiCounty.name, 'districts');
  await input('level', 'province', 'change');
  await select('北京', 'districts');
  await clickMapRegion('东城区');
  await waitFor(
    'document.querySelector("#breadcrumb [aria-current]").textContent === "东城区" && document.getElementById("map").dataset.ready === "true"',
  );
  await input('level', '', 'change');
  await click('#breadcrumb button[data-id="100000"]');
  await waitFor(
    'document.getElementById("map").dataset.mapKey === "100000-districts" && document.getElementById("map").dataset.ready === "true"',
  );
  await screenshot('national.png');
  await exportPng(false);
  for (const name of ['全国', '江西', '台湾', '新疆', '西藏']) {
    await input('level', name === '全国' ? 'country' : 'province', 'change');
    await select(name, 'districts');
    await select(name, 'outline');
  }
  await select('西藏', 'districts');
  assert.equal(
    await js(
      '(async () => { const data = await window.atlas.getMap({regionId:"540000",variant:"districts"}); return data.features.filter(f => f.properties.name === "山南市").length; })()',
    ),
    1,
  );
  await screenshot('tibet-audited.png');
  await input('level', 'city', 'change');
  for (const variant of ['districts', 'outline']) {
    await select('平顶山', variant);
    await screenshot('pingdingshan-' + variant + '.png');
  }
  await input('search', '');
  await input('level', 'city', 'change');
  await js(
    '(() => { for (const id of ["beijing", "nan2_chang1", "tai2_bei3"]) document.querySelector(".city-button[data-id=" + id + "]").click(); })()',
  );
  await waitFor(
    'document.getElementById("map").dataset.ready === "true" && document.getElementById("map").dataset.mapKey === "tai2_bei3-outline"',
  );
  await select('北京', 'districts');
  await input('map-title', '北京 · 持久化标题');
  await input('export-scale', '2', 'change');
  await click('[data-palette=clay]');
  await click('#zoom-in');
  const opaque = await exportPng(false);
  const expected = await js('document.getElementById("export-size").textContent');
  assert.ok(expected.startsWith(opaque.width + ' × ' + opaque.height));
  await exportPng(true);
  await click('[name=variant][value=outline]');
  await waitFor('document.getElementById("map").dataset.ready === "true"');
  await click('#reset-style');
  assert.equal(await js('document.querySelector("[name=variant]:checked").value'), 'outline');
  assert.equal(await js('document.getElementById("transparent").checked'), true);
  await fs.writeFile(
    path.join(output, 'outline.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await input('map-title', '重启后仍保留');
  await new Promise((resolve) => {
    window.webContents.once('did-finish-load', resolve);
    window.webContents.reload();
  });
  await waitFor('document.getElementById("map").dataset.ready === "true"');
  assert.equal(await js('document.getElementById("map-title").value'), '重启后仍保留');
  assert.equal(await js('document.getElementById("map").dataset.mapKey'), 'beijing-outline');
  await input('level', 'county', 'change');
  await select('东湖区', 'outline');
  await new Promise((resolve) => {
    window.webContents.once('did-finish-load', resolve);
    window.webContents.reload();
  });
  await waitFor('document.getElementById("map").dataset.ready === "true"');
  assert.equal(await js('document.getElementById("map").dataset.mapKey'), eastLake.id + '-outline');
  assert.deepEqual(errors, []);
  assert.deepEqual(networkRequests, []);
  await fs.writeFile(
    path.join(output, 'smoke-report.json'),
    JSON.stringify(
      {
        cities: 392,
        provinces: 34,
        regions: 3680,
        counties: 3253,
        maps: validated,
        image: opaque,
        checks: [
          'DOM interactions',
          'national-province-city-county map clicks and breadcrumbs',
          'county PNG export and preferences reload',
          'search',
          'filter',
          'render',
          'rapid changes',
          'API contracts',
          'opaque PNG',
          'transparent PNG',
          'style reset',
          'preferences reload',
        ],
        errors,
        networkRequests,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: DOM-driven modes, rapid changes, PNG alpha, appearance reset and preferences reload',
  );
};
