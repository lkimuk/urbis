import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveRegion } from '../renderer/catalog.mjs';
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
test('preferences migrate old aliases and fall back to the national map for removed detail', () => {
  const main = {
    id: 'tdt-360100',
    aliases: ['nan2_chang1'],
    name: '南昌市',
    province: '江西',
  };
  const country = { id: '100000', level: 'country' };
  const regions = [main, country];
  assert.equal(resolveRegion(regions, 'nan2_chang1'), main);
  assert.equal(resolveRegion(regions, main.id), main);
  assert.equal(resolveRegion(regions, 'removed-historical-county'), country);
  assert.equal(resolveRegion(regions, 'removed'), country);
});
