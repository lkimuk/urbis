const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
// Attach before navigation so startup failures and requests are included.
exports.observe = function observe(window) {
  const errors = [],
    networkRequests = [];
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
  return { errors, networkRequests };
};

exports.run = async function run(window, output, { errors, networkRequests }) {
  const { nativeImage } = require('electron');
  await fs.mkdir(output, { recursive: true });
  const js = (code) =>
    window.webContents.executeJavaScript(
      '(async()=>{const {createAtlasClient}=await import("./desktop-api.mjs");const atlas=createAtlasClient(window.atlas);return (' +
        code +
        ');})()',
    );
  async function waitFor(expression) {
    const deadline = Date.now() + 15000;
    while (!(await js(expression))) {
      if (Date.now() > deadline) throw Error('Timed out: ' + expression);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  async function input(id, value, event = 'input') {
    await js(
      '(()=>{const el=document.getElementById(' +
        JSON.stringify(id) +
        ');el.value=' +
        JSON.stringify(value) +
        ';el.dispatchEvent(new Event(' +
        JSON.stringify(event) +
        ',{bubbles:true}));})()',
    );
  }
  const click = (selector) =>
    js('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const ready = (id) =>
    waitFor(
      'document.getElementById("map").dataset.ready==="true" && document.getElementById("map").dataset.mapKey.startsWith(' +
        JSON.stringify(id + '-') +
        ')',
    );
  async function screenshot(filename) {
    await window.webContents.executeJavaScript(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    await fs.writeFile(
      path.join(output, filename),
      (await window.webContents.capturePage()).toPNG(),
    );
  }
  await waitFor('document.getElementById("map").dataset.ready==="true"');
  const catalog = await js('atlas.getRegions()');
  assert.equal(catalog.length, 3293);
  assert.equal(await js('document.getElementById("dataset")'), null);
  assert.equal(await js('typeof require'), 'undefined');
  assert.ok(catalog.every((r) => !Object.hasOwn(r, 'variants')));
  assert.equal(
    await js(
      '(async()=>{const {PALETTES}=await import("./settings.mjs");return [...document.querySelectorAll("[data-palette]")].every(button=>{const p=PALETTES[button.dataset.palette];return button.style.getPropertyValue("--swatch-fill")===p.fill && button.style.getPropertyValue("--swatch-border")===p.border;});})()',
    ),
    true,
    'Swatches must use the shared palette',
  );
  const byId = new Map(catalog.map((r) => [r.id, r]));
  async function select(id, variant = 'districts') {
    const region = byId.get(id);
    assert.ok(region, id);
    await input('level', region.level, 'change');
    await input('province', '', 'change');
    await input('search', region.name);
    const selector = '.city-button[data-id="' + id + '"]';
    assert.equal(
      await js(
        '(()=>{const list=document.getElementById("city-list"),first=list.firstChild,button=document.querySelector(' +
          JSON.stringify(selector) +
          ');button.focus();button.click();return list.firstChild===first && button.isConnected && document.activeElement===button && button.getAttribute("aria-pressed")==="true";})()',
      ),
      true,
      'Selection must preserve list nodes and keyboard focus',
    );
    await click('[name=variant][value=' + variant + ']');
    await ready(id);
    assert.equal(await js('document.getElementById("map").dataset.mapKey'), id + '-' + variant);
  }
  async function clickMapRegion(name, target) {
    // Zoom small districts before a real click, matching ordinary use of the map.
    if (['东城区', '中西区'].includes(name)) {
      await js(
        '(()=>{const el=document.getElementById("map"),chart=echarts.getInstanceByDom(el),geo=echarts.getMap(chart.getOption().geo[0].map).geoJSON;const r=echarts.parseGeoJSON(geo).find(r=>r.name===' +
          JSON.stringify(name) +
          ');chart.setOption({geo:{center:r.getCenter(),zoom:4}});})()',
      );
    }
    const point = await js(
      '(()=>{const el=document.getElementById("map"),chart=echarts.getInstanceByDom(el),option=chart.getOption(),geo=echarts.getMap(option.geo[0].map).geoJSON;const r=echarts.parseGeoJSON(geo).find(r=>r.name===' +
        JSON.stringify(name) +
        ');let xy=r.getCenter();if(!r.contain(xy)){const b=r.getBoundingRect();outer:for(let i=1;i<30;i++)for(let j=1;j<30;j++){const p=[b.x+b.width*i/30,b.y+b.height*j/30];if(r.contain(p)){xy=p;break outer;}}}const pixel=chart.convertToPixel({geoIndex:0},xy),rect=el.getBoundingClientRect();return {x:Math.round(rect.left+pixel[0]),y:Math.round(rect.top+pixel[1])};})()',
    );
    await screenshot('click-' + target + '.png');
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      ...point,
    });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await ready(target);
  }
  async function exportPng(transparent = false) {
    await js(
      '(()=>{const el=document.getElementById("transparent");el.checked=' +
        transparent +
        ';el.dispatchEvent(new Event("change"));})()',
    );
    await click('#export');
    await waitFor(
      '!document.getElementById("export").disabled && document.getElementById("toast").textContent.startsWith("已保存")',
    );
    const name = await js('document.querySelector("#breadcrumb [aria-current]").textContent');
    const image = nativeImage.createFromPath(path.join(output, name + '-行政区地图.png'));
    assert.equal(image.toBitmap()[3], transparent ? 0 : 255);
    assert.ok(image.getSize().width > 0);
    return image.getSize();
  }
  const validation = await js(
    '(async()=>{let count=0,lines=0;for(const r of await atlas.getRegions())for(const variant of ["districts","outline"]){const data=await atlas.getMap({regionId:r.id,variant});const parsed=echarts.parseGeoJSON(data);if(parsed.length!==data.features.length)throw Error(r.id);for(const part of parsed){const b=part.getBoundingRect();if(![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0)throw Error(r.id);}lines+=(data.boundaryLines||[]).length;count++;}return {count,lines};})()',
  );
  assert.equal(validation.count, 6586);
  assert.ok(validation.lines > 0);
  assert.equal(
    await js(
      '(async()=>{try{await atlas.getMap({regionId:"../package",variant:"districts"});return null;}catch(e){return e.code;}})()',
    ),
    'MAP_NOT_FOUND',
  );
  assert.equal(
    await js(
      '(async()=>{try{await atlas.saveImage({dataURL:"data:image/png;base64,aGVsbG8="});return null;}catch(e){return e.code;}})()',
    ),
    'INVALID_IMAGE',
  );
  console.log('PASS: all 6586 modes, decoded bounds, boundary lines, isolated API');
  const registration = await js(
    'echarts.getInstanceByDom(document.getElementById("map")).getOption().geo[0].map',
  );
  for (const region of catalog.filter((r) => r.level === 'county').slice(0, 16)) {
    await select(region.id);
    const displayed = await js(
      '(()=>{const name=echarts.getInstanceByDom(document.getElementById("map")).getOption().geo[0].map;return {registration:name,names:echarts.getMap(name).geoJSON.features.map(f=>f.properties.name)};})()',
    );
    assert.equal(displayed.registration, registration, 'Browsing must replace one registration');
    assert.deepEqual(
      displayed.names,
      region.districtNames,
      'Reused registration must show new geometry',
    );
    assert.equal(
      await js('echarts.getMap(' + JSON.stringify(region.id + '-districts') + ') || null'),
      null,
      'No per-region ECharts registration may accumulate',
    );
  }
  await input('level', '', 'change');
  for (const query of ['nanchang', 'nc', '南昌', '台北', 'bj', 'jiangxi', 'jx', 'shaanxi']) {
    await input('search', query);
    assert.ok(await js('document.querySelectorAll(".city-button").length>0'), query);
  }
  await select('100000');
  await screenshot('national.png');
  assert.ok(
    await js(
      'echarts.getInstanceByDom(document.getElementById("map")).getOption().series.find(s=>s.id==="boundary-lines").data.length>0',
    ),
  );
  await exportPng();
  await input('search', '');
  await input('level', '', 'change');
  await clickMapRegion('江西省', '360000');
  await screenshot('province.png');
  await clickMapRegion('南昌市', 'tdt-360100');
  await clickMapRegion('东湖区', 'tdt-county-360102');
  assert.equal(await js('document.querySelectorAll("#breadcrumb button").length'), 4);
  await screenshot('county.png');
  await exportPng();
  await select('110000');
  async function checkBeijingLabels() {
    const labels = await js(
      'echarts.getInstanceByDom(document.getElementById("map")).getOption().graphic[0].elements.filter(e=>e.type==="text").map(e=>({text:e.style.text,x:e.style.x,y:e.style.y}))',
    );
    assert.equal(labels.length, 16, 'All Beijing district labels must be visible');
    assert.equal(new Set(labels.map((label) => label.text)).size, 16);
    const drawn = await js(
      '(()=>{const chart=echarts.getInstanceByDom(document.getElementById("map"));chart.getZr().flush();return chart.getZr().storage.getDisplayList().filter(e=>e.type==="tspan"&&!e.ignore&&!e.invisible).map(e=>e.style.text);})()',
    );
    for (const label of labels)
      assert.ok(drawn.includes(label.text), 'Label must be actually drawn: ' + label.text);
    assert.ok(
      await js(
        'echarts.getInstanceByDom(document.getElementById("map")).getOption().graphic[0].elements.some(e=>e.type==="polyline")',
      ),
      'Tiny districts must have leader lines',
    );
  }
  await checkBeijingLabels();
  await screenshot('beijing-labels.png');
  window.setSize(1080, 720);
  await screenshot('beijing-labels-compact.png');
  await checkBeijingLabels();
  window.setSize(1480, 960);
  await screenshot('beijing-labels-restored.png');
  await click('#labels');
  assert.equal(
    await js(
      'echarts.getInstanceByDom(document.getElementById("map")).getOption().graphic[0].elements.filter(e=>e.type==="text").length',
    ),
    0,
  );
  await click('#labels');
  await checkBeijingLabels();
  await input('border-color', '#ffffff');
  const textStyles = await js(
    '(()=>{const o=echarts.getInstanceByDom(document.getElementById("map")).getOption();return [o.title[0].textStyle.color,o.geo[0].label.color,o.geo[0].emphasis.label.color,o.geo[0].select.label.color];})()',
  );
  assert.deepEqual(textStyles, Array(4).fill('#526d60'));
  await screenshot('independent-text.png');
  await input('text-color', '#ff0000');
  assert.equal(
    await js(
      'echarts.getInstanceByDom(document.getElementById("map")).getOption().geo[0].itemStyle.borderColor',
    ),
    '#ffffff',
  );
  await exportPng();
  const textPixels = nativeImage
    .createFromPath(path.join(output, '北京-行政区地图.png'))
    .toBitmap();
  let redPixels = 0;
  for (let i = 0; i < textPixels.length; i += 4)
    if (
      textPixels[i] < 20 &&
      textPixels[i + 1] < 20 &&
      textPixels[i + 2] > 230 &&
      textPixels[i + 3] === 255
    )
      redPixels++;
  assert.ok(redPixels > 20, 'Export must contain the independently colored text');
  await click('[data-palette=atlas]');
  await clickMapRegion('东城区', 'tdt-county-110101');
  await select('710000');
  await clickMapRegion('台北市', 'tdt-county-710009');
  await select('810000');
  await clickMapRegion('中西区', 'tdt-county-810101');
  await select('820000');
  await screenshot('macau.png');
  console.log('PASS: real map clicks, Taiwan, Hong Kong and Macau');
  await select('540000');
  await screenshot('tibet-audited.png');
  for (const variant of ['districts', 'outline']) {
    await select('tdt-410400', variant);
    await screenshot('pingdingshan-' + variant + '.png');
  }
  await select('460000');
  await screenshot('hainan-lines.png');
  await click('#zoom-in');
  assert.ok(
    await js('echarts.getInstanceByDom(document.getElementById("map")).getOption().geo[0].zoom>1'),
  );
  await exportPng();
  const size = await exportPng(true);
  await select('100000');
  await click('[data-palette=clay]');
  await click('[name=variant][value=outline]');
  await ready('100000');
  await click('#reset-style');
  assert.equal(await js('document.querySelector("[name=variant]:checked").value'), 'outline');
  assert.equal(await js('document.getElementById("transparent").checked'), true);
  await js(
    '(()=>{const s=JSON.parse(localStorage.getItem("city-atlas"));s.regionId="nan2_chang1--e4b89ce6b996e58cba";s.title="旧标题";localStorage.setItem("city-atlas",JSON.stringify(s));})()',
  );
  await new Promise((resolve) => {
    window.webContents.once('did-finish-load', resolve);
    window.webContents.reload();
  });
  await ready('tdt-county-360102');
  assert.equal(await js('document.getElementById("map-title").value'), '旧标题');
  await input('map-title', '保存标题');
  await input('text-color', '#123456');
  await new Promise((resolve) => {
    window.webContents.once('did-finish-load', resolve);
    window.webContents.reload();
  });
  await ready('tdt-county-360102');
  assert.equal(await js('document.getElementById("map-title").value'), '保存标题');
  assert.equal(await js('document.getElementById("text-color").value'), '#123456');
  window.setSize(1080, 720);
  await screenshot('compact-layout.png');
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(
    await js('document.getElementById("export").getBoundingClientRect().bottom <= innerHeight'),
    true,
  );
  window.setSize(1480, 960);
  await js('document.getElementById("search").focus()');
  await screenshot('search-focus.png');
  assert.deepEqual(errors, []);
  assert.deepEqual(networkRequests, []);
  await fs.writeFile(
    path.join(output, 'smoke-report.json'),
    JSON.stringify(
      {
        regions: catalog.length,
        maps: validation.count,
        boundarySegments: validation.lines,
        image: size,
        errors,
        networkRequests,
        checks: [
          'all modes',
          'shape-aware labels and leader lines at normal and compact sizes',
          'bounded map registration',
          'list identity and keyboard focus',
          'shared palette swatches',
          'startup console and network monitoring',
          'real map clicks',
          'boundary line layer',
          'PNG alpha',
          'independent text color and PNG export',
          'single-source navigation',
          'legacy preference migration',
          'reload',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS: outlines, lines, PNG alpha, legacy migration and reload');
};
