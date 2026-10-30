import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveRegion, filterRegions } from '../renderer/catalog.mjs';
const require = createRequire(import.meta.url);
const { readSnapshot, clipLines } = require('../scripts/tianditu-catalog.cjs');
const source = fileURLToPath(new URL('../data/tianditu/', import.meta.url));

test('Tianditu snapshot distinguishes administrative polygons from boundary lines and detects changed bytes', () => {
  const { layers } = readSnapshot(source);
  assert.deepEqual(
    Object.values(layers).map((layer) => [layer.polygons.length, layer.lines.length]),
    [
      [34, 8],
      [375, 13],
      [2890, 7],
    ],
  );
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-tdt-'));
  try {
    fs.cpSync(source, temp, { recursive: true });
    fs.appendFileSync(path.join(temp, 'cities.geojson'), ' ');
    assert.throws(() => readSnapshot(temp), /integrity mismatch/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
test('boundary clipping preserves crossing segments and splits disconnected paths', () => {
  const lines = [
    {
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [-2, 1],
            [2, 1],
            [4, 1],
            [2, 2],
            [-2, 2],
          ],
        ],
      },
    },
  ];
  assert.deepEqual(clipLines(lines, [0, 0, 3, 3]), [
    [
      [0, 1],
      [2, 1],
      [3, 1],
    ],
    [
      [3, 1.5],
      [2, 2],
      [0, 2],
    ],
  ]);
});
test('preferences migrate unambiguous legacy aliases, with explicit historical fallback and dataset filters', () => {
  const main = {
    id: 'tdt-360100',
    dataset: 'tianditu',
    aliases: ['nan2_chang1', 'tai2_bei3'],
    name: '南昌市',
    province: '江西',
  };
  const legacy = { id: 'tai2_bei3', dataset: 'legacy', name: '臺北', province: '台湾' };
  const country = { id: '100000', level: 'country' };
  const regions = [main, legacy, country];
  assert.equal(resolveRegion(regions, 'nan2_chang1'), main);
  assert.equal(resolveRegion(regions, 'tai2_bei3'), legacy);
  assert.equal(resolveRegion(regions, 'removed'), country);
  assert.deepEqual(filterRegions(regions, { dataset: 'legacy' }), [legacy]);
});
