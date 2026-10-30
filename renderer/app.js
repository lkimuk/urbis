import { DEFAULTS, PALETTES, loadSettings, saveSettings } from './settings.mjs';
import { filterCities, createMapLoader } from './catalog.mjs';
import { createMapView } from './map-view.mjs';
import { createAtlasClient } from './desktop-api.mjs';

const $ = (id) => document.getElementById(id);
const api = createAtlasClient(window.atlas);
let settings = loadSettings(localStorage);
let cities = [];
let currentCity;
let currentMap;
let busy = true;
let exporting = false;
let toastTimer;
const load = createMapLoader((request) => api.getMap(request));
const view = createMapView({
  echarts: window.echarts,
  element: $('map'),
  onSelect: (name) => {
    if (!busy) $('selection-status').textContent = currentCity.name + ' / ' + name;
  },
  onResize: updateDimensions,
});

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 6000);
}

function updateDimensions() {
  const { width, height } = view.dimensions(settings.scale);
  $('export-size').textContent = width + ' × ' + height + ' px · PNG';
}

function syncControls() {
  document.querySelector('input[name=variant][value=' + settings.variant + ']').checked = true;
  $('labels').checked = settings.labels;
  $('labels').disabled = settings.variant === 'outline';
  $('show-title').checked = settings.showTitle;
  $('map-title').disabled = !settings.showTitle;
  $('map-title').value = settings.title;
  for (const key of ['fill', 'border', 'background']) {
    $(key + '-color').value = settings[key];
    $(key + '-value').textContent = settings[key].toUpperCase();
  }
  $('line-width').value = settings.width;
  $('line-width-value').textContent = settings.width + ' px';
  $('export-scale').value = settings.scale;
  $('transparent').checked = settings.transparent;
  document.querySelectorAll('[data-palette]').forEach((button) => {
    const active = button.dataset.palette === settings.palette;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('paper').classList.toggle('transparent', settings.transparent);
  $('paper').style.backgroundColor = settings.background;
  updateDimensions();
}

function updateActions() {
  $('export').disabled = busy || exporting || !currentMap;
  $('export').textContent = exporting ? '正在保存…' : '导出 PNG 图片';
  $('map').setAttribute('aria-busy', String(busy));
  $('map').dataset.ready = String(!busy && Boolean(currentMap));
  for (const id of ['zoom-in', 'zoom-out', 'reset-view']) $(id).disabled = busy || !currentMap;
}

function renderList() {
  const matches = filterCities(cities, { query: $('search').value, province: $('province').value });
  $('results-count').textContent = matches.length + ' 个条目';
  const fragment = document.createDocumentFragment();
  let group;
  for (const city of matches) {
    if (city.province !== group) {
      group = city.province;
      const heading = document.createElement('div');
      heading.className = 'province-heading';
      heading.textContent = group;
      fragment.append(heading);
    }
    const button = document.createElement('button');
    button.className = 'city-button';
    button.dataset.id = city.id;
    const active = city.id === currentCity?.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    const name = document.createElement('span');
    name.textContent = city.name;
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '↗';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(name, arrow);
    fragment.append(button);
  }
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '没有找到这个城市。试试城市简称、拼音，或切换至全部地区。';
    fragment.append(empty);
  }
  $('city-list').replaceChildren(fragment);
}

function changeSettings(patch) {
  settings = { ...settings, ...patch };
  saveSettings(localStorage, settings);
  syncControls();
  if (
    !busy &&
    currentMap &&
    Object.keys(patch).some((key) => key !== 'scale') &&
    currentMap.key === currentCity.id + '-' + settings.variant
  )
    view.update(settings);
}

async function loadMap() {
  if (!currentCity) return;
  const city = currentCity;
  busy = true;
  updateActions();
  $('map-message').textContent = '正在打开' + city.name + '…';
  $('map-message').classList.remove('error');
  $('map-message').hidden = false;
  try {
    const result = await load(city.id, settings.variant);
    if (!result) return;
    view.show({ city, ...result, settings });
    currentMap = result;
    busy = false;
    $('map-message').hidden = true;
    $('map').dataset.mapKey = result.key;
    $('map-status').textContent =
      city.name +
      ' · ' +
      (settings.variant === 'districts'
        ? city.districtNames.length + ' 个区县 / 地图分区'
        : '纯轮廓');
    updateActions();
  } catch (error) {
    currentMap = null;
    busy = false;
    updateActions();
    $('map-message').classList.add('error');
    $('map-message').textContent = '地图加载失败：' + error.message + '。请重新选择城市重试。';
    $('map-status').textContent = '地图加载失败';
  }
}

async function selectCity(city) {
  if (city.id !== settings.cityId) settings = { ...settings, cityId: city.id, title: '' };
  currentCity = city;
  saveSettings(localStorage, settings);
  syncControls();
  renderList();
  $('breadcrumb').textContent = city.province + '  /  ' + city.name;
  $('selection-status').textContent = '点击地图查看区县名称';
  await loadMap();
}

async function exportImage() {
  if (busy || !currentMap || exporting) return;
  exporting = true;
  updateActions();
  try {
    // Capture all export inputs before awaiting the save dialog. City/style changes cannot rename this image.
    const dataURL = view.capturePng(settings);
    const filename =
      currentCity.name + '-' + (settings.variant === 'districts' ? '区县地图' : '轮廓地图');
    const result = await api.saveImage({ dataURL, filename });
    if (!result.canceled)
      toast(
        '已保存 ' + result.size.width + ' × ' + result.size.height + ' px 图片：' + result.filePath,
      );
  } catch (error) {
    toast('导出失败：' + error.message, true);
  } finally {
    exporting = false;
    updateActions();
  }
}

$('search').addEventListener('input', renderList);
$('province').addEventListener('change', renderList);
$('city-list').addEventListener('click', (event) => {
  const button = event.target.closest('.city-button');
  if (button) void selectCity(cities.find((city) => city.id === button.dataset.id));
});
document.querySelectorAll('[name=variant]').forEach((input) =>
  input.addEventListener('change', () => {
    changeSettings({ variant: input.value });
    void loadMap();
  }),
);
for (const [id, key] of [
  ['labels', 'labels'],
  ['show-title', 'showTitle'],
  ['transparent', 'transparent'],
]) {
  $(id).addEventListener('change', () => changeSettings({ [key]: $(id).checked }));
}
for (const key of ['fill', 'border', 'background']) {
  $(key + '-color').addEventListener('input', () =>
    changeSettings({ [key]: $(key + '-color').value, palette: '' }),
  );
}
$('line-width').addEventListener('input', () =>
  changeSettings({ width: Number($('line-width').value) }),
);
$('map-title').addEventListener('input', () => changeSettings({ title: $('map-title').value }));
$('export-scale').addEventListener('change', () =>
  changeSettings({ scale: Number($('export-scale').value) }),
);
document.querySelectorAll('[data-palette]').forEach((button) =>
  button.addEventListener('click', () => {
    changeSettings({ ...PALETTES[button.dataset.palette], palette: button.dataset.palette });
  }),
);
$('reset-style').addEventListener('click', () => {
  // Reset appearance, preserving the selected map mode, export options, and current view.
  const { fill, border, background, width, labels, showTitle, palette, title } = DEFAULTS;
  changeSettings({ fill, border, background, width, labels, showTitle, palette, title });
});
$('reset-view').addEventListener('click', () => view.reset());
$('zoom-in').addEventListener('click', () => view.zoom(1.25));
$('zoom-out').addEventListener('click', () => view.zoom(0.8));
$('export').addEventListener('click', exportImage);
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 'k') {
    event.preventDefault();
    $('search').focus();
    $('search').select();
  }
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    void exportImage();
  }
});
window.addEventListener(
  'beforeunload',
  () => {
    view.dispose();
    clearTimeout(toastTimer);
  },
  { once: true },
);

async function initialize() {
  syncControls();
  updateActions();
  try {
    cities = await api.getCities();
    if (!cities.length) throw new Error('地图库为空');
    $('city-total').textContent = cities.length;
    for (const province of new Set(cities.map((city) => city.province))) {
      const option = document.createElement('option');
      option.value = province;
      option.textContent = province;
      $('province').append(option);
    }
    await selectCity(
      cities.find((city) => city.id === settings.cityId) ||
        cities.find((city) => city.name === '南昌') ||
        cities[0],
    );
    $('city-list').querySelector('.active')?.scrollIntoView({ block: 'center' });
  } catch (error) {
    busy = false;
    updateActions();
    $('map-message').textContent = '无法打开城市目录：' + error.message;
    $('map-message').classList.add('error');
  }
}

void initialize();
