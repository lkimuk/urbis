import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { decodePng, pngFilename, createImageExporter } = require('../electron/image-export.cjs');
const { createMapRepository } = require('../electron/map-repository.cjs');
const { registerAtlasIpc } = require('../electron/ipc.cjs');
const { AtlasError } = require('../electron/errors.cjs');
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

test('PNG validation rejects non-images and oversized headers before native decoding', () => {
  assert.equal(decodePng(png).width, 1);
  for (const value of [
    null,
    'data:image/jpeg;base64,aaaa',
    'data:image/png;base64,aGVsbG8=',
    'data:image/png;base64,%%%',
  ]) {
    assert.throws(() => decodePng(value), { code: 'INVALID_IMAGE' });
  }
  const buffer = Buffer.from(png.split(',')[1], 'base64');
  buffer.writeUInt32BE(100000, 16);
  buffer.writeUInt32BE(100000, 20);
  assert.throws(() => decodePng('data:image/png;base64,' + buffer.toString('base64')), {
    code: 'IMAGE_TOO_LARGE',
  });
});

test('Windows filenames preserve ordinary text and sanitize forbidden characters and device names', () => {
  assert.equal(pngFilename('北京-区县地图'), '北京-区县地图.png');
  assert.equal(pngFilename('export-x01'), 'export-x01.png');
  assert.equal(pngFilename('a/b' + String.fromCharCode(0) + 'c'), 'a_b_c.png');
  assert.equal(pngFilename('a' + String.fromCharCode(92) + 'b'), 'a_b.png');
  assert.equal(pngFilename('CON.txt'), '_CON.txt.png');
  assert.equal(pngFilename('... '), '城市地图.png');
});

test('export cancellation writes nothing, and a write failure permits retry', async () => {
  const nativeImage = {
    createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) }),
  };
  const cancel = createImageExporter({
    nativeImage,
    choosePath: async () => null,
    writeFile: () => assert.fail('Canceled export wrote a file'),
  });
  assert.deepEqual(await cancel({ dataURL: png }), { canceled: true });
  let attempts = 0;
  const save = createImageExporter({
    nativeImage,
    choosePath: async () => 'test-output',
    writeFile: async () => {
      if (++attempts === 1) throw Error('denied');
    },
  });
  await assert.rejects(save({ dataURL: png }), { code: 'SAVE_FAILED' });
  assert.equal((await save({ dataURL: png })).filePath, path.resolve('test-output.png'));
});

test('export rejects duplicate dialogs while the original save is pending', async () => {
  let finish;
  const nativeImage = {
    createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) }),
  };
  const save = createImageExporter({
    nativeImage,
    choosePath: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const first = save({ dataURL: png });
  await assert.rejects(save({ dataURL: png }), { code: 'EXPORT_BUSY' });
  finish(null);
  assert.deepEqual(await first, { canceled: true });
});

test('repository hides file paths, rejects invalid requests, and reports missing resources', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-repository-'));
  try {
    await fs.mkdir(path.join(temp, 'maps'));
    await fs.writeFile(
      path.join(temp, 'catalog.json'),
      JSON.stringify([
        {
          id: 'city',
          name: '城市',
          variants: { districts: 'city.json', outline: '../catalog.json' },
        },
      ]),
    );
    await fs.writeFile(path.join(temp, 'maps/city.json'), '{"features":[]}');
    const repository = await createMapRepository(temp);
    assert.deepEqual(repository.listCities(), [{ id: 'city', name: '城市' }]);
    for (const request of [
      null,
      {},
      { cityId: '../catalog', variant: 'districts' },
      { cityId: 'city', variant: 'unknown' },
    ]) {
      await assert.rejects(repository.getMap(request), { code: 'MAP_NOT_FOUND' });
    }
    assert.deepEqual(await repository.getMap({ cityId: 'city', variant: 'districts' }), {
      features: [],
    });
    await assert.rejects(repository.getMap({ cityId: 'city', variant: 'outline' }), {
      code: 'MAP_UNAVAILABLE',
    });
    await fs.unlink(path.join(temp, 'maps/city.json'));
    await assert.rejects(repository.getMap({ cityId: 'city', variant: 'districts' }), {
      code: 'MAP_UNAVAILABLE',
    });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('IPC rejects untrusted frames before service invocation and preserves domain error codes', async () => {
  const handlers = new Map();
  const webContents = {};
  let calls = 0;
  registerAtlasIpc({
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    getWindow: () => ({ webContents }),
    pageURL: 'file:///atlas/index.html',
    repository: {
      listCities: () => {
        calls++;
        return [];
      },
      getMap: () => {
        throw new AtlasError('MAP_NOT_FOUND', 'missing');
      },
    },
    savePng: () => {},
  });
  const trusted = { sender: webContents, senderFrame: { url: 'file:///atlas/index.html' } };
  const untrusted = { ...trusted, senderFrame: { url: 'file:///other.html' } };
  assert.equal((await handlers.get('atlas:cities')(untrusted)).error.code, 'UNTRUSTED_CALLER');
  assert.equal(calls, 0);
  assert.deepEqual(await handlers.get('atlas:cities')(trusted), { ok: true, value: [] });
  assert.deepEqual((await handlers.get('atlas:map')(trusted, {})).error, {
    code: 'MAP_NOT_FOUND',
    message: 'missing',
  });
});
