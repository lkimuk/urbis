import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, normalizeSettings, loadSettings, saveSettings } from '../renderer/settings.mjs';
import { createMapLoader, filterRegions, regionTrail, childRegion } from '../renderer/catalog.mjs';

test('preferences reject corrupt data and keep valid custom settings', () => {
  for (const value of [null, [], true, 'bad']) assert.deepEqual(normalizeSettings(value), DEFAULTS);
  const settings = normalizeSettings({
    width: Infinity,
    scale: '4',
    labels: 1,
    palette: 'toString',
    fill: 'red',
    title: 'x'.repeat(60),
    regionId: 'beijing',
  });
  assert.equal(settings.width, 1);
  assert.equal(settings.scale, 2);
  assert.equal(settings.palette, 'atlas');
  assert.equal(settings.fill, DEFAULTS.fill);
  assert.equal(settings.title.length, 40);
  assert.equal(settings.regionId, 'beijing');
  assert.equal(normalizeSettings({ cityId: 'beijing' }).regionId, 'beijing');
  assert.equal(normalizeSettings({ border: '#ffffff' }).text, DEFAULTS.text);
  assert.equal(normalizeSettings({ border: '#ffffff', palette: 'clay' }).text, '#8a5a42');
  assert.equal(normalizeSettings({ text: 'invalid' }).text, DEFAULTS.text);
  assert.equal(normalizeSettings({ border: '#ffffff', text: '#123456' }).text, '#123456');
  assert.deepEqual(loadSettings({ getItem: () => '{bad' }), DEFAULTS);
  assert.doesNotThrow(() =>
    saveSettings(
      {
        setItem: () => {
          throw Error('full');
        },
      },
      DEFAULTS,
    ),
  );
  assert.equal(normalizeSettings({ palette: '', width: 0.3, transparent: true }).palette, '');
});

test('hierarchy resolves exact feature links, breadcrumbs, and level filters', () => {
  const country = {
    id: '100000',
    name: '全国',
    level: 'country',
    parentId: null,
    children: [{ name: '江西', regionId: '360000' }],
  };
  const province = {
    id: '360000',
    name: '江西',
    level: 'province',
    parentId: '100000',
    children: [{ name: '南昌市', regionId: 'nc' }],
  };
  const city = { id: 'nc', name: '南昌', level: 'city', parentId: '360000', children: [] };
  const regions = [country, province, city];
  assert.deepEqual(regionTrail(regions, city), regions);
  assert.equal(childRegion(regions, country, '江西'), province);
  assert.equal(childRegion(regions, province, '南昌市'), city);
  assert.equal(childRegion(regions, province, '南昌'), undefined);
  assert.deepEqual(filterRegions(regions, { level: 'province' }), [province]);
});

test('search normalizes Taiwanese aliases, spaces and pinyin while respecting province', () => {
  const cities = [
    { id: 'a', name: '臺北', province: '台湾', pinyin: 'taibei', initials: 'tb' },
    { id: 'b', name: '北京', province: '直辖市及港澳', pinyin: 'beijing', initials: 'bj' },
  ];
  for (const query of ['台北', '臺北', ' TAI BEI ', 'tb', '台湾']) {
    assert.equal(filterRegions(cities, { query })[0].id, 'a');
  }
  assert.equal(filterRegions(cities, { query: 'bj' })[0].id, 'b');
  assert.deepEqual(filterRegions(cities, { query: 'bj', province: '台湾' }), []);
  assert.deepEqual(filterRegions(cities, { query: '不存在' }), []);
});

test('map loading deduplicates concurrent requests and discards stale success', async () => {
  let calls = 0;
  let resolve;
  const load = createMapLoader(() => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const first = load('a', 'outline');
  const last = load('a', 'outline');
  await Promise.resolve();
  resolve({ features: [] });
  assert.equal(await first, null);
  assert.equal((await last).key, 'a-outline');
  assert.equal(calls, 1);
  const revisit = load('a', 'outline');
  await Promise.resolve();
  resolve({ features: [] });
  await revisit;
  assert.equal(calls, 2, 'Completed maps are read again instead of retained indefinitely');
});

test('map loading ignores stale failures and retries a failed latest request', async () => {
  let rejectOld;
  let attempts = 0;
  const load = createMapLoader(({ regionId }) => {
    if (regionId === 'old')
      return new Promise((_, reject) => {
        rejectOld = reject;
      });
    if (++attempts === 1) throw Error('temporary');
    return { features: [] };
  });
  const old = load('old', 'districts');
  await assert.rejects(load('new', 'districts'), /temporary/);
  rejectOld(Error('stale'));
  assert.equal(await old, null);
  assert.equal((await load('new', 'districts')).key, 'new-districts');
});
