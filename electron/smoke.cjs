const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { nativeImage } = require('electron');

// Exercise DOM events and the public bridge. Do not reach into renderer module state.
exports.run = async function run(window, output) {
  await fs.mkdir(output, { recursive: true });
  const errors = [];
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
    const actual = path.join(output, '北京-区县地图.png');
    const image = nativeImage.createFromPath(actual);
    const size = image.getSize();
    assert.equal(image.toBitmap()[3], transparent ? 0 : 255);
    await fs.copyFile(actual, path.join(output, filename));
    return size;
  }

  await waitFor('document.getElementById("map").dataset.ready === "true"');
  assert.equal(await js('document.querySelectorAll(".city-button").length'), 392);
  assert.equal(await js('typeof require'), 'undefined');
  assert.equal(await js('typeof currentCity'), 'undefined');
  const cities = await js('window.atlas.getCities()');
  assert.equal(cities.length, 392);
  assert.ok(cities.every((city) => !Object.hasOwn(city, 'variants')));
  await fs.writeFile(
    path.join(output, 'workbench.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  console.log('PASS: initial map, isolated modules, catalog without filesystem paths');

  for (const query of ['nanchang', 'nc', '南昌', '台北', 'bj']) {
    await input('search', query);
    assert.ok(await js('document.querySelectorAll(".city-button").length > 0'), query);
  }
  await input('search', '不存在的城市');
  assert.equal(await js('document.querySelectorAll(".city-button").length'), 0);
  await input('search', '');
  await input('province', '江西', 'change');
  assert.equal(await js('document.querySelectorAll(".city-button").length'), 11);
  await input('province', '', 'change');

  const validated = await js(
    '(async () => { let count = 0; for (const city of await window.atlas.getCities()) for (const variant of ["districts", "outline"]) { const data = await window.atlas.getMap({cityId:city.id,variant}); const regions = echarts.parseGeoJSON(data); if (!regions.length) throw Error(city.id); for (const region of regions) { const b = region.getBoundingRect(); if (![b.x,b.y,b.width,b.height].every(Number.isFinite)) throw Error(city.id); } count++; } return count; })()',
  );
  assert.equal(validated, 784);
  const invalid = await js(
    '(async () => { try { await window.atlas.getMap({cityId:"../package",variant:"districts"}); return null; } catch(e) { return {message:e.message,code:e.code}; } })()',
  );
  assert.equal(invalid.message, '未找到对应地图');
  assert.equal(invalid.code, 'MAP_NOT_FOUND');
  const badImage = await js(
    '(async () => { try { await window.atlas.saveImage({dataURL:"data:image/png;base64,aGVsbG8="}); return false; } catch(e) { return e.code === "INVALID_IMAGE"; } })()',
  );
  assert.equal(badImage, true);
  console.log('PASS: search, province filters, all 784 maps, API error contracts');

  for (const name of ['北京', '南昌', '臺北', '香港', '乌鲁木齐', '海口']) {
    await select(name, 'districts');
    await select(name, 'outline');
  }
  await input('search', '');
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
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, 'smoke-report.json'),
    JSON.stringify(
      {
        cities: 392,
        maps: validated,
        image: opaque,
        checks: [
          'DOM interactions',
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
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: DOM-driven modes, rapid changes, PNG alpha, appearance reset and preferences reload',
  );
};
