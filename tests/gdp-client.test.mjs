import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  createGdpIndex,
  buildGdpModel,
  gdpTooltip,
  gdpClass,
  gdpColors,
} from '../renderer/gdp-model.mjs';
import { createGdpStore } from '../renderer/gdp-store.mjs';
import { normalizeSettings } from '../renderer/settings.mjs';
import { createAtlasClient } from '../renderer/desktop-api.mjs';
const require = createRequire(import.meta.url);
const {
  createGdpRepository,
  validateGdpDataset,
  metadata,
} = require('../electron/gdp-repository.cjs');
const { prepareGdpResources } = require('../scripts/prepare-gdp-resources.cjs');
const { registerAtlasIpc } = require('../electron/ipc.cjs');
const catalog = [
  {
    id: 'province',
    name: '甲省',
    level: 'province',
    children: [{ name: '同名市', regionId: 'city' }],
  },
  {
    id: 'city',
    name: '同名市',
    level: 'city',
    parentId: 'province',
    children: [
      { name: '中心区', regionId: 'district' },
      { name: '新区', regionId: 'new' },
    ],
  },
  { id: 'district', name: '中心区', level: 'county', parentId: 'city', children: [] },
  { id: 'new', name: '新区', level: 'county', parentId: 'city', children: [] },
];
const observation = (regionId, value) => ({
  regionId,
  regionName: catalog.find((r) => r.id === regionId).name,
  value,
  status: 'preliminary',
  source: {
    publisher: '统计局',
    title: '2025年经济运行',
    url: 'https://example.gov.cn/gdp',
    publishedOn: '2026-01-21',
  },
});
const dataset = (year = 2025) => ({
  schemaVersion: 1,
  year,
  unit: '亿元',
  currency: 'CNY',
  priceBasis: 'current',
  retrievedOn: '2026-11-02',
  records: [observation('province', 30000), observation('city', 2000)],
  exclusions: [],
});
const geometry = (...names) => ({
  features: names.map((name) => ({
    properties: { name },
    geometry: { type: 'Polygon', coordinates: [] },
  })),
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('GDP matching follows exact child IDs and never assigns city totals to districts', () => {
  const data = dataset();
  const index = createGdpIndex(data);
  const province = buildGdpModel(index, catalog[0], geometry('同名市', '未匹配市'), 'districts');
  assert.equal(province.covered, 1);
  assert.equal(province.areas[0].record.value, 2000);
  assert.equal(province.areas[1].status, 'missing');
  const city = buildGdpModel(index, catalog[1], geometry('中心区', '新区'), 'districts');
  assert.equal(city.current.record.value, 2000);
  assert.equal(city.covered, 0);
  assert.ok(city.areas.every((a) => !a.record));
  assert.match(gdpTooltip(city, '中心区'), /暂无数据/);
  assert.equal(
    buildGdpModel(index, catalog[1], geometry('同名市'), 'outline').areas[0].record.value,
    2000,
  );
  const leaf = buildGdpModel(index, catalog[2], geometry('中心区'), 'districts');
  assert.equal(leaf.choropleth, false);
  assert.equal(leaf.current.status, 'missing');
  data.records.push({ ...observation('district', 100), regionId: 'other-district' });
  assert.equal(
    buildGdpModel(createGdpIndex(data), catalog[1], geometry('中心区'), 'districts').covered,
    0,
  );
});

test('scope exceptions override values, classification boundaries are explicit, and palettes are valid', () => {
  const data = dataset();
  data.records.push(observation('district', 100), {
    ...observation('new', 200),
    scopeNote: '范围变更',
  });
  data.exclusions.push({ regionId: 'district', reason: '旧边界' });
  const model = buildGdpModel(
    createGdpIndex(data),
    catalog[1],
    geometry('中心区', '新区'),
    'districts',
  );
  assert.equal(model.covered, 0);
  assert.ok(model.areas.every((area) => area.status === 'excluded'));
  assert.ok(
    gdpTooltip(model, '中心区').includes('统计范围待核实' + String.fromCharCode(10) + '旧边界'),
  );
  assert.equal(gdpClass(499.9, model.thresholds), 0);
  assert.equal(gdpClass(500, model.thresholds), 1);
  assert.equal(gdpClass(10000, model.thresholds), 4);
  for (const fill of ['#b8cdbe', '#d7b399', '#b6c5d3', '#000000', '#ffffff'])
    assert.ok(gdpColors(fill).every((color) => /^#[a-f0-9]{6}$/.test(color)));
});

test('GDP contract rejects duplicate IDs, wrong names, values, dates and unsafe sources', () => {
  assert.equal(validateGdpDataset(dataset(), catalog).records.length, 2);
  for (const mutate of [
    (d) => d.records.push(d.records[0]),
    (d) => {
      d.records[0].regionName = '别的省';
    },
    (d) => {
      d.records[0].value = NaN;
    },
    (d) => {
      d.records[0].value = 0;
    },
    (d) => {
      d.records[0].source.url = 'file:///private';
    },
    (d) => {
      d.records[0].source.publishedOn = '2026-02-30';
    },
    (d) => {
      d.retrievedOn = '2025-01-01';
    },
    (d) => {
      d.exclusions = [{ regionId: 'unknown', reason: '错位' }];
    },
  ]) {
    const data = dataset();
    mutate(data);
    assert.throws(() => validateGdpDataset(data, catalog));
  }
});

test('GDP resources validate provenance and repository integrity, then recover after failed reads', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'urbis-gdp-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const sources = path.join(temp, 'data/sources');
  const out = path.join(temp, 'resources/gdp');
  await fs.mkdir(sources, { recursive: true });
  const data = dataset();
  const sha = (raw) => createHash('sha256').update(raw).digest('hex');
  const manifest = {
    ...metadata(data),
    files: { 'official.txt': sha('official') },
    sources: data.records.map((r, i) => ({
      id: 'source-' + i,
      regionId: r.regionId,
      regionName: r.regionName,
      year: data.year,
      value: String(r.value),
      status: r.status,
      file: 'official.txt',
      ...r.source,
    })),
  };
  const snapshot = {
    ...data,
    records: data.records.map((r, i) => ({
      ...r,
      level: catalog[i].level,
      sourceId: 'source-' + i,
      sourceFile: 'official.txt',
      publishedOn: r.source.publishedOn,
    })),
  };
  const write = (file, value) => fs.writeFile(path.join(temp, 'data', file), JSON.stringify(value));
  await fs.writeFile(path.join(sources, 'official.txt'), 'official');
  await write('map-scope.json', { datasets: [{ year: 2025, exclusions: [] }] });
  await write('manifest-2025.json', manifest);
  await write('gdp-2025.json', snapshot);
  assert.equal(prepareGdpResources(path.join(temp, 'data'), out, catalog)[0].recordCount, 2);
  const repository = createGdpRepository(path.join(temp, 'resources'), catalog);
  assert.deepEqual(await repository.list(), [metadata(data)]);
  for (const request of [
    null,
    {},
    { year: '../2025' },
    { year: 2024 },
    { year: 2025, file: 'other' },
  ])
    await assert.rejects(repository.get(request), { code: 'GDP_YEAR_NOT_FOUND' });
  const good = await fs.readFile(path.join(out, '2025.json'));
  await fs.writeFile(path.join(out, '2025.json'), '{}');
  await assert.rejects(repository.get({ year: 2025 }), { code: 'GDP_UNAVAILABLE' });
  await fs.writeFile(path.join(out, '2025.json'), good);
  const loaded = await repository.get({ year: 2025 });
  assert.equal(loaded.records[1].value, 2000);
  assert.equal(Object.hasOwn(loaded.records[0], 'sourceFile'), false);
  snapshot.records[0].value++;
  await write('gdp-2025.json', snapshot);
  assert.throws(
    () => prepareGdpResources(path.join(temp, 'data'), out, catalog),
    /snapshot.manifest mismatch/,
  );
  snapshot.records[0].value--;
  snapshot.currency = 'USD';
  await write('gdp-2025.json', snapshot);
  assert.throws(
    () => prepareGdpResources(path.join(temp, 'data'), out, catalog),
    /metadata mismatch/,
  );
  snapshot.currency = 'CNY';
  await write('gdp-2025.json', snapshot);
  await fs.writeFile(path.join(sources, 'official.txt'), 'tampered');
  assert.throws(() => prepareGdpResources(path.join(temp, 'data'), out, catalog), /source changed/);
  const brokenIndex = JSON.parse(await fs.readFile(path.join(out, 'index.json')));
  brokenIndex.datasets[0].metadata.unit = '万元';
  await fs.writeFile(path.join(out, 'index.json'), JSON.stringify(brokenIndex));
  const retryIndex = createGdpRepository(path.join(temp, 'resources'), catalog);
  await assert.rejects(retryIndex.list(), { code: 'GDP_UNAVAILABLE' });
  brokenIndex.datasets[0].metadata.unit = '亿元';
  await fs.writeFile(path.join(out, 'index.json'), JSON.stringify(brokenIndex));
  assert.equal((await retryIndex.list())[0].year, 2025);
});

test('GDP store ignores stale annual responses, caches successes and retries failures', async () => {
  const old = deferred(),
    latest = deferred(),
    started = deferred();
  const changes = [];
  const store = createGdpStore({
    listDatasets: async () => [{ year: 2024 }, { year: 2025 }],
    getDataset: ({ year }) => {
      if (year === 2024) {
        started.resolve();
        return old.promise;
      }
      return latest.promise;
    },
    onChange: (state) => changes.push(state),
  });
  const first = store.load(2024);
  await started.promise;
  const second = store.load(2025);
  latest.resolve(dataset());
  await second;
  old.resolve(dataset(2024));
  await first;
  assert.equal(store.getState().year, 2025);
  assert.equal(store.getState().index.dataset.year, 2025);
  await store.load(1900);
  assert.equal(store.getState().year, 2025);
  assert.ok(changes.filter((s) => s.status === 'loading').every((s) => s.index === null));
  let calls = 0;
  const retry = createGdpStore({
    listDatasets: async () => [{ year: 2025 }],
    onChange: () => {},
    getDataset: async () => {
      if (++calls === 1) throw Error('read failed');
      return dataset();
    },
  });
  await retry.load();
  assert.equal(retry.getState().status, 'error');
  await retry.load();
  assert.equal(retry.getState().status, 'ready');
  await retry.load();
  assert.equal(calls, 2);
});

test('GDP IPC uses trusted frames and client contracts; preferences validate annual selections', async () => {
  const handlers = new Map(),
    sender = {};
  let calls = 0;
  registerAtlasIpc({
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    getWindow: () => ({ webContents: sender }),
    pageURL: 'file:///app.html',
    gdp: {
      list: () => {
        calls++;
        return [metadata(dataset())];
      },
      get: async (request) => {
        assert.deepEqual(request, { year: 2025 });
        return dataset();
      },
    },
    repository: {},
    savePng: () => {},
  });
  const trusted = { sender, senderFrame: { url: 'file:///app.html' } };
  const untrusted = { ...trusted, senderFrame: { url: 'file:///other.html' } };
  for (const channel of ['atlas:gdp', 'atlas:gdp-datasets'])
    assert.equal(
      (await handlers.get(channel)(untrusted, { year: 2025 })).error.code,
      'UNTRUSTED_CALLER',
    );
  assert.equal(calls, 0);
  const client = createAtlasClient({
    listGdpDatasets: () => handlers.get('atlas:gdp-datasets')(trusted),
    getGdp: (payload) => handlers.get('atlas:gdp')(trusted, payload),
  });
  assert.equal((await client.listGdpDatasets())[0].year, 2025);
  assert.equal((await client.getGdp({ year: 2025 })).year, 2025);
  assert.equal(normalizeSettings({ thematic: 'gdp', gdpYear: 2025 }).gdpYear, 2025);
  assert.equal(normalizeSettings({ thematic: 'other', gdpYear: '2025' }).thematic, 'none');
  assert.equal(normalizeSettings({ gdpYear: 2200 }).gdpYear, null);
});
