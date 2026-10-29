/* global echarts */
'use strict';
const $ = id => document.getElementById(id);
const defaults = { variant: 'districts', labels: true, showTitle: true, fill: '#b8cdbe', border: '#526d60', background: '#faf9f5', width: 1, scale: 2, transparent: false, palette: 'atlas' };
const palettes = { atlas: { fill: '#b8cdbe', border: '#526d60', background: '#faf9f5' }, clay: { fill: '#d7b399', border: '#8a5a42', background: '#fbf6ef' }, ink: { fill: '#b6c5d3', border: '#435c75', background: '#f4f6f8' } };
let state = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem('city-atlas') || '{}');
  for (const key of ['labels', 'showTitle', 'transparent']) if (typeof saved[key] === 'boolean') state[key] = saved[key];
  for (const key of ['fill', 'border', 'background']) if (/^#[a-f0-9]{6}$/i.test(saved[key])) state[key] = saved[key];
  if (['districts', 'outline'].includes(saved.variant)) state.variant = saved.variant;
  if ([1, 2, 3, 4].includes(saved.scale)) state.scale = saved.scale;
  if (saved.width >= 0.3 && saved.width <= 3) state.width = Number(saved.width);
  if (saved.palette === '' || palettes[saved.palette]) state.palette = saved.palette;
  if (typeof saved.cityId === 'string') state.cityId = saved.cityId;
} catch { /* Start with defaults when preferences cannot be restored. */ }
let cities = [];
let currentCity;
let mapKey;
let busy = true;
let exporting = false;
let requestVersion = 0;
let toastTimer;
const mapCache = new Map();
const regionCache = new Map();
const chart = echarts.init($('map'), null, { renderer: 'canvas', devicePixelRatio: window.devicePixelRatio });

function persist() { try { localStorage.setItem('city-atlas', JSON.stringify(state)); } catch { /* Storage may be unavailable. */ } }
function toast(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
}
function syncControls() {
  document.querySelector(`input[name=variant][value=${state.variant}]`).checked = true;
  $('labels').checked = state.labels; $('labels').disabled = state.variant === 'outline';
  $('show-title').checked = state.showTitle; $('map-title').disabled = !state.showTitle;
  for (const [key, id] of [['fill', 'fill'], ['border', 'border'], ['background', 'background']]) {
    $(id + '-color').value = state[key]; $(id + '-value').textContent = state[key].toUpperCase();
  }
  $('line-width').value = state.width; $('line-width-value').textContent = `${state.width} px`;
  $('export-scale').value = state.scale; $('transparent').checked = state.transparent;
  document.querySelectorAll('[data-palette]').forEach(button => {
    const active = button.dataset.palette === state.palette; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('paper').classList.toggle('transparent', state.transparent);
  $('paper').style.backgroundColor = state.background;
  updateDimensions();
}
function updateDimensions() { $('export-size').textContent = `${Math.round(chart.getWidth() * state.scale)} × ${Math.round(chart.getHeight() * state.scale)} px · PNG`; }
function renderList() {
  const query = $('search').value.trim().toLowerCase().replaceAll('台', '臺');
  const province = $('province').value;
  const matches = cities.filter(city => (!province || province === city.province) &&
    (!query || city.name.replaceAll('台', '臺').toLowerCase().includes(query) || city.province.includes(query) || city.pinyin.includes(query) || city.initials.includes(query)));
  $('results-count').textContent = `${matches.length} 个条目`;
  const fragment = document.createDocumentFragment();
  let group;
  for (const city of matches) {
    if (city.province !== group) {
      group = city.province; const heading = document.createElement('div'); heading.className = 'province-heading'; heading.textContent = group; fragment.append(heading);
    }
    const button = document.createElement('button'); button.className = 'city-button'; button.dataset.id = city.id;
    const active = city.id === currentCity?.id; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    const name = document.createElement('span'); name.textContent = city.name;
    const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
    button.append(name, arrow); button.addEventListener('click', () => selectCity(city)); fragment.append(button);
  }
  if (!matches.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '没有找到这个城市。试试城市简称、拼音，或切换至全部地区。'; fragment.append(empty); }
  $('city-list').replaceChildren(fragment);
}
function setBusy(value) {
  busy = value; $('export').disabled = value || exporting || !mapKey;
  $('map').setAttribute('aria-busy', String(value));
  for (const id of ['zoom-in', 'zoom-out', 'reset-view']) $(id).disabled = value || !mapKey;
}
function updateChart(reset = false) {
  if (!mapKey || busy) return;
  const previous = reset ? null : chart.getOption()?.series?.[0];
  const title = $('map-title').value.trim() || currentCity.name;
  chart.setOption({
    animation: false, backgroundColor: state.transparent ? 'transparent' : state.background,
    title: { show: state.showTitle, text: title, subtext: `${currentCity.province}  /  ${state.variant === 'districts' ? '行政区划' : '城市轮廓'}`, left: 30, top: 25, textStyle: { color: state.border, fontFamily: 'SimSun, serif', fontSize: 25, fontWeight: 'normal' }, subtextStyle: { color: state.border, fontFamily: 'Microsoft YaHei', fontSize: 10, opacity: 0.7 }, itemGap: 12 },
    tooltip: { trigger: 'item', confine: true, renderMode: 'richText', formatter: params => params.name, backgroundColor: '#f9f8f1', borderColor: '#c3cdbb', textStyle: { color: '#314b39', fontSize: 12 } },
    series: [{ id: 'city', type: 'map', map: mapKey, roam: true, selectedMode: 'single', scaleLimit: { min: 0.5, max: 12 }, zoom: previous?.zoom || 1, ...(previous?.center ? { center: previous.center } : {}),
      left: '10%', right: '10%', top: state.showTitle ? 125 : '10%', bottom: '10%',
      label: { show: state.labels && state.variant === 'districts', color: state.border, fontSize: 11, fontFamily: 'Microsoft YaHei' },
      labelLayout: { hideOverlap: true },
      itemStyle: { areaColor: state.fill, borderColor: state.border, borderWidth: state.width },
      emphasis: { label: { show: state.variant === 'districts', color: state.border }, itemStyle: { areaColor: state.fill, shadowBlur: 8, shadowColor: '#29463833' } },
      select: { label: { color: state.border }, itemStyle: { areaColor: state.fill, borderWidth: state.width + 1.4, borderColor: state.border } },
      data: []
    }]
  }, { notMerge: true });
  $('map').setAttribute('aria-label', `${currentCity.name}${state.variant === 'districts' ? '区县地图' : '轮廓地图'}`);
  $('map-status').textContent = `${currentCity.name} · ${state.variant === 'districts' ? `${currentCity.districtNames.length} 个区县 / 地图分区` : '纯轮廓'}`;
  layoutLabels();
}
function layoutLabels() {
  if (busy || !mapKey || state.variant !== 'districts' || !state.labels) return;
  if (!regionCache.has(mapKey)) {
    const regions = echarts.parseGeoJSON(echarts.getMap(mapKey).geoJSON);
    regions.sort((a, b) => { const ar = a.getBoundingRect(); const br = b.getBoundingRect(); return br.width * br.height - ar.width * ar.height; });
    regionCache.set(mapKey, regions);
  }
  const occupied = [];
  const data = regionCache.get(mapKey).map(region => {
    const [x, y] = chart.convertToPixel({ seriesIndex: 0 }, region.getCenter());
    const width = Array.from(region.name).length * 11 + 8;
    const box = { left: x - width / 2, right: x + width / 2, top: y - 9, bottom: y + 9 };
    const show = !occupied.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);
    if (show) occupied.push(box);
    return { name: region.name, label: { show } };
  });
  chart.setOption({ series: [{ id: 'city', data }] });
}
async function selectCity(city) {
  currentCity = city; state.cityId = city.id; $('map-title').value = '';
  $('breadcrumb').textContent = `${city.province}  /  ${city.name}`;
  $('selection-status').textContent = '点击地图查看区县名称';
  renderList(); persist(); await loadMap();
}
async function loadMap() {
  const version = ++requestVersion; const city = currentCity; const variant = state.variant; const key = `${city.id}-${variant}`;
  setBusy(true); $('map-message').textContent = `正在打开${city.name}…`; $('map-message').classList.remove('error'); $('map-message').hidden = false;
  try {
    if (!mapCache.has(key)) {
      const geoJSON = await window.atlas.getMap(city.id, variant);
      if (version !== requestVersion) return;
      echarts.registerMap(key, geoJSON); mapCache.set(key, true);
    }
    if (version !== requestVersion) return;
    mapKey = key; setBusy(false); updateChart(true); $('map-message').hidden = true;
  } catch (error) {
    if (version !== requestVersion) return;
    mapKey = null; setBusy(false); $('map-message').hidden = false; $('map-message').classList.add('error');
    $('map-message').textContent = `地图加载失败：${error.message}。请重新选择城市重试。`; $('map-status').textContent = '地图加载失败';
  }
}
async function exportImage() {
  if (busy || !mapKey || exporting) return;
  exporting = true; $('export').disabled = true;
  try {
    // Export from a separate canvas so hover, selection, and interaction state never appear in the image.
    const element = document.createElement('div');
    element.style.cssText = `position:fixed;left:-20000px;top:0;width:${chart.getWidth()}px;height:${chart.getHeight()}px;`;
    document.body.append(element);
    let exportChart; let dataURL;
    try {
      exportChart = echarts.init(element, null, { renderer: 'canvas', devicePixelRatio: 1 });
      const option = chart.getOption(); option.tooltip = { show: false };
      for (const series of option.series) { series.selectedMap = {}; series.selectedMode = false; series.silent = true; }
      exportChart.setOption(option);
      dataURL = exportChart.getDataURL({ type: 'png', pixelRatio: state.scale, backgroundColor: state.transparent ? 'rgba(0,0,0,0)' : state.background });
    } finally { exportChart?.dispose(); element.remove(); }
    const result = await window.atlas.saveImage({ dataURL, filename: `${currentCity.name}-${state.variant === 'districts' ? '区县地图' : '轮廓地图'}` });
    if (!result.canceled) toast(`已保存 ${result.size.width} × ${result.size.height} px 图片：${result.filePath}`);
    return result;
  } catch (error) { toast(`导出失败：${error.message}`, true); throw error; }
  finally { exporting = false; $('export').disabled = busy || !mapKey; }
}
$('search').addEventListener('input', renderList); $('province').addEventListener('change', renderList);
document.querySelectorAll('[name=variant]').forEach(input => input.addEventListener('change', async () => { state.variant = input.value; syncControls(); persist(); await loadMap(); }));
for (const [id, key] of [['labels', 'labels'], ['show-title', 'showTitle'], ['transparent', 'transparent']]) $(id).addEventListener('change', () => { state[key] = $(id).checked; syncControls(); persist(); updateChart(); });
for (const [id, key] of [['fill', 'fill'], ['border', 'border'], ['background', 'background']]) $(id + '-color').addEventListener('input', () => { state[key] = $(id + '-color').value; state.palette = ''; syncControls(); persist(); updateChart(); });
$('line-width').addEventListener('input', () => { state.width = Number($('line-width').value); syncControls(); persist(); updateChart(); });
$('map-title').addEventListener('input', () => updateChart());
$('export-scale').addEventListener('change', () => { state.scale = Number($('export-scale').value); updateDimensions(); persist(); });
document.querySelectorAll('[data-palette]').forEach(button => button.addEventListener('click', () => { Object.assign(state, palettes[button.dataset.palette], { palette: button.dataset.palette }); syncControls(); persist(); updateChart(); }));
$('reset-style').addEventListener('click', async () => { const variant = state.variant; state = { ...defaults, cityId: currentCity?.id }; $('map-title').value = ''; syncControls(); persist(); if (variant !== state.variant) await loadMap(); else updateChart(true); });
$('reset-view').addEventListener('click', () => updateChart(true));
function zoom(factor) { if (!mapKey || busy) return; const series = chart.getOption().series[0]; chart.setOption({ series: [{ id: 'city', zoom: Math.max(0.5, Math.min(12, series.zoom * factor)) }] }); layoutLabels(); }
$('zoom-in').addEventListener('click', () => zoom(1.25)); $('zoom-out').addEventListener('click', () => zoom(0.8));
$('export').addEventListener('click', () => exportImage().catch(() => {}));
chart.on('click', params => { $('selection-status').textContent = `${currentCity.name} / ${params.name}`; });
chart.on('georoam', () => requestAnimationFrame(layoutLabels));
new ResizeObserver(() => { chart.resize(); layoutLabels(); updateDimensions(); }).observe($('paper'));
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('search').focus(); $('search').select(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); exportImage().catch(() => {}); }
});
async function initialize() {
  syncControls(); setBusy(true);
  try {
    cities = await window.atlas.getCities(); $('city-total').textContent = cities.length;
    for (const province of [...new Set(cities.map(city => city.province))]) { const option = document.createElement('option'); option.value = province; option.textContent = province; $('province').append(option); }
    await selectCity(cities.find(city => city.id === state.cityId) || cities.find(city => city.name === '南昌') || cities[0]);
    $('city-list').querySelector('.active')?.scrollIntoView({ block: 'center' });
  } catch (error) { $('map-message').textContent = `无法打开城市目录：${error.message}`; $('map-message').classList.add('error'); }
}
window.atlasReady = initialize();
