import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, normalizeSettings, loadSettings, saveSettings } from '../renderer/settings.mjs';
import { createMapLoader, filterCities } from '../renderer/catalog.mjs';

test('preferences reject corrupt data and keep valid custom settings', () => {
  for (const value of [null, [], true, 'bad']) assert.deepEqual(normalizeSettings(value), DEFAULTS);
  const settings = normalizeSettings({
    width: Infinity,
    scale: '4',
    labels: 1,
    palette: 'toString',
    fill: 'red',
    title: 'x'.repeat(60),
    cityId: 'beijing',
  });
  assert.equal(settings.width, 1);
  assert.equal(settings.scale, 2);
  assert.equal(settings.palette, 'atlas');
  assert.equal(settings.fill, DEFAULTS.fill);
  assert.equal(settings.title.length, 40);
  assert.equal(settings.cityId, 'beijing');
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

test('search normalizes Taiwanese aliases, spaces and pinyin while respecting province', () => {
  const cities = [
    { id: 'a', name: '臺北', province: '台湾', pinyin: 'taibei', initials: 'tb' },
    { id: 'b', name: '北京', province: '直辖市及港澳', pinyin: 'beijing', initials: 'bj' },
  ];
  for (const query of ['台北', '臺北', ' TAI BEI ', 'tb', '台湾']) {
    assert.equal(filterCities(cities, { query })[0].id, 'a');
  }
  assert.equal(filterCities(cities, { query: 'bj' })[0].id, 'b');
  assert.deepEqual(filterCities(cities, { query: 'bj', province: '台湾' }), []);
  assert.deepEqual(filterCities(cities, { query: '不存在' }), []);
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
  await load('a', 'outline');
  assert.equal(calls, 1);
});

test('map loading ignores stale failures and retries a failed latest request', async () => {
  let rejectOld;
  let attempts = 0;
  const load = createMapLoader(({ cityId }) => {
    if (cityId === 'old')
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
