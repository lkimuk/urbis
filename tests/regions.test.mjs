import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { appendRegions } = require('../scripts/region-catalog.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));

test('offline snapshot has complete hierarchy, valid geometry, and fails on changed source bytes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-regions-'));
  try {
    const source = path.join(temp, 'source');
    fs.cpSync(path.join(root, 'desktop/data/regions'), source, { recursive: true });
    fs.mkdirSync(path.join(temp, 'maps'));
    const structure = JSON.parse(fs.readFileSync(path.join(root, 'structure.json')));
    const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry.json')));
    const provinces = new Map(
      Object.entries(structure).flatMap(([province, names]) =>
        names.map((name) => [name, province]),
      ),
    );
    const cities = Object.entries(registry.PINYIN_MAP)
      .filter(([name]) => !name.endsWith('轮廓'))
      .map(([name, id]) => ({ id, name, province: provinces.get(name) || '直辖市及港澳' }));
    const regions = appendRegions(cities, source, temp);
    assert.equal(regions.length, 427);
    assert.equal(new Set(regions.map((region) => region.id)).size, 427);
    const byId = new Map(regions.map((region) => [region.id, region]));
    assert.equal(byId.get('100000').children.length, 34);
    for (const region of regions) {
      if (region.parentId) assert.ok(byId.has(region.parentId), region.name);
      for (const child of region.children) {
        assert.ok(region.districtNames.includes(child.name));
        assert.equal(byId.get(child.regionId).parentId, region.id);
      }
    }
    const echarts = require('echarts');
    for (const region of regions.filter((item) => item.level !== 'city')) {
      for (const filename of Object.values(region.variants)) {
        const data = JSON.parse(fs.readFileSync(path.join(temp, 'maps', filename)));
        const parsed = echarts.parseGeoJSON(data);
        assert.ok(parsed.length, filename);
        for (const part of parsed) {
          const box = part.getBoundingRect();
          assert.ok([box.x, box.y, box.width, box.height].every(Number.isFinite), filename);
          assert.ok(box.width > 0 && box.height > 0, filename);
        }
      }
    }
    const report = JSON.parse(fs.readFileSync(path.join(temp, 'region-links-report.json')));
    assert.deepEqual(
      report.unmatched.map((entry) => entry.feature),
      ['中国属钓鱼岛'],
    );
    fs.appendFileSync(path.join(source, 'china.json'), ' ');
    assert.throws(() => appendRegions(cities, source, temp), /integrity mismatch/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
