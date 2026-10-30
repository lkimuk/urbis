import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { appendCounties } = require('../scripts/county-catalog.cjs');
const echarts = require('echarts');
const root = fileURLToPath(new URL('../../', import.meta.url));

test('county extraction preserves encoded geometry, stable IDs, and direct municipality links', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-counties-'));
  try {
    fs.mkdirSync(path.join(temp, 'maps'));
    const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry.json')));
    const regions = [];
    const originals = new Map();
    for (const [id, provinceId, provinceName] of [
      ['nan2_chang1', '360000', '江西'],
      ['tai2_bei3', '710000', '台湾'],
      ['beijing', '110000', '北京'],
    ]) {
      let data;
      vm.runInNewContext(
        fs.readFileSync(path.join(root, 'js', registry.FILE_MAP[id] + '.js'), 'utf8'),
        {
          echarts: {
            registerMap: (_, geoJSON) => {
              data = geoJSON;
            },
          },
        },
        { timeout: 2000 },
      );
      fs.writeFileSync(path.join(temp, 'maps', id + '.json'), JSON.stringify(data));
      const names = data.features.map((feature) => feature.properties.name);
      const province = {
        id: provinceId,
        name: provinceName,
        level: 'province',
        districtNames: names,
        children: [],
      };
      const city = {
        id,
        name: id,
        province: provinceName,
        level: 'city',
        parentId: provinceId,
        children: [],
        source: 'fixture',
        variants: { districts: id + '.json' },
      };
      regions.push(province, city);
      originals.set(id, JSON.parse(JSON.stringify(data)));
    }
    const result = appendCounties(regions, temp);
    const counties = result.filter((region) => region.level === 'county');
    assert.equal(
      counties.length,
      [...originals.values()].reduce((sum, data) => sum + data.features.length, 0),
    );
    assert.equal(new Set(counties.map((county) => county.id)).size, counties.length);
    for (const county of counties) {
      assert.equal(county.variants.districts, county.variants.outline);
      const data = JSON.parse(fs.readFileSync(path.join(temp, 'maps', county.variants.districts)));
      const original = originals.get(county.parentId);
      assert.deepEqual(data, {
        ...original,
        features: original.features.filter((feature) => feature.properties.name === county.name),
      });
      assert.ok(echarts.parseGeoJSON(data).length);
      assert.ok(
        regions
          .find((region) => region.id === county.parentId)
          .children.some((child) => child.regionId === county.id && child.name === county.name),
      );
    }
    assert.equal(
      regions.find((region) => region.id === '110000').children.length,
      originals.get('beijing').features.length,
    );
    const before = counties.map((county) => county.id).sort();
    for (const [id, data] of originals) {
      data.features.reverse();
      fs.writeFileSync(path.join(temp, 'maps', id + '.json'), JSON.stringify(data));
    }
    for (const region of regions) region.children = [];
    assert.deepEqual(
      appendCounties(regions, temp)
        .filter((region) => region.level === 'county')
        .map((county) => county.id)
        .sort(),
      before,
    );
    const duplicate = originals.get('beijing');
    duplicate.features.push(duplicate.features[0]);
    fs.writeFileSync(path.join(temp, 'maps/beijing.json'), JSON.stringify(duplicate));
    assert.throws(() => appendCounties(regions, temp), /duplicate county/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
