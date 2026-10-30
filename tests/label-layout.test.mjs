import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import * as echarts from 'echarts';
import { layoutRegionLabels } from '../renderer/label-layout.mjs';

const rectangle = (left, top, right, bottom) => [
  [left, top],
  [right, top],
  [right, bottom],
  [left, bottom],
  [left, top],
];
const measureText = (text) => Array.from(text).length * 12;
const overlap = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
function validLabels(labels, width, height) {
  for (const label of labels) {
    assert.ok(label.box.left >= 10 && label.box.right <= width - 10);
    assert.ok(label.box.top >= 10 && label.box.bottom <= height - 10);
    for (const other of labels)
      if (other !== label) assert.equal(overlap(label.box, other.box), false);
  }
}

test('labels choose usable interiors of concave regions and avoid holes', () => {
  const concave = [
    [20, 20],
    [150, 20],
    [150, 60],
    [65, 60],
    [65, 180],
    [20, 180],
    [20, 20],
  ];
  const labels = layoutRegionLabels(
    [
      { name: '凹形区', polygons: [[concave]] },
      { name: '孔洞区', polygons: [[rectangle(200, 20, 380, 200), rectangle(250, 60, 330, 150)]] },
    ],
    { width: 400, height: 220, measureText },
  );
  assert.equal(labels.length, 2);
  assert.ok(labels.every((label) => !label.displaced));
  assert.ok(labels[0].box.bottom <= 60 || labels[0].box.right <= 65);
  assert.equal(overlap(labels[1].box, { left: 250, top: 60, right: 330, bottom: 150 }), false);
  validLabels(labels, 400, 220);
});

test('small districts stagger nearby without overlapping text or the title', () => {
  const regions = Array.from({ length: 2 }, (_, i) => ({
    name: '小区' + i,
    polygons: [
      [
        rectangle(
          170 + (i % 3) * 12,
          100 + Math.floor(i / 3) * 12,
          178 + (i % 3) * 12,
          108 + Math.floor(i / 3) * 12,
        ),
      ],
    ],
  }));
  const reserved = [{ left: 20, top: 15, right: 180, bottom: 50 }];
  const labels = layoutRegionLabels(regions, { width: 400, height: 250, measureText, reserved });
  assert.equal(labels.length, regions.length);
  assert.ok(labels.every((label) => label.displaced));
  for (const label of labels) {
    assert.equal(overlap(label.box, reserved[0]), false);
    assert.ok(Math.hypot(label.x - label.anchor[0], label.y - label.anchor[1]) <= 38);
    assert.equal(Object.hasOwn(label, 'line'), false);
  }
  validLabels(labels, 400, 250);
});

test('multipart labels use the visible component and omit completely offscreen shapes', () => {
  const labels = layoutRegionLabels(
    [
      {
        name: '多块区',
        polygons: [[rectangle(-400, -400, -100, -100)], [rectangle(50, 50, 150, 150)]],
      },
      { name: '画外区', polygons: [[rectangle(500, 500, 600, 600)]] },
    ],
    { width: 240, height: 200, measureText },
  );
  assert.equal(labels.length, 1);
  assert.equal(labels[0].name, '多块区');
  assert.ok(!labels[0].line);
});

test('Beijing labels remain readable at normal and compact sizes and adapt to zoom', () => {
  const data = JSON.parse(
    fs.readFileSync(new URL('../data/tianditu/counties.geojson', import.meta.url)),
  );
  data.features = data.features.filter(
    (f) =>
      f.properties.gb?.startsWith('15611') && ['Polygon', 'MultiPolygon'].includes(f.geometry.type),
  );
  const name = 'label-layout-test';
  echarts.registerMap(name, data);
  for (const [width, height, zoom] of [
    [928, 849, 1],
    [568, 609, 1],
    [928, 849, 1.6],
  ]) {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
    try {
      chart.setOption({
        geo: { map: name, left: '10%', right: '10%', top: 90, bottom: '10%', zoom },
      });
      const project = (p) => chart.convertToPixel({ geoIndex: 0 }, p);
      const regions = echarts.parseGeoJSON(data).map((region) => ({
        name: region.name,
        polygons: region.geometries.map((g) =>
          [g.exterior, ...(g.interiors || [])].map((r) => r.map(project)),
        ),
      }));
      const labels = layoutRegionLabels(regions, { width, height, measureText });
      validLabels(labels, width, height);
      if (zoom === 1) {
        assert.equal(labels.length, 16);
        assert.ok(labels.some((label) => label.displaced));
        const west = labels.find((label) => label.name === '西城区'),
          east = labels.find((label) => label.name === '东城区');
        assert.ok(west.y < east.y, 'Adjacent core districts must stagger vertically');
        for (const label of [west, east]) {
          assert.ok(Math.hypot(label.x - label.anchor[0], label.y - label.anchor[1]) <= 38);
          assert.equal(Object.hasOwn(label, 'line'), false);
        }
      }
      for (const label of labels) {
        const region = echarts.parseGeoJSON(data).find((region) => region.name === label.name);
        assert.ok(
          region.contain(chart.convertFromPixel({ geoIndex: 0 }, label.anchor)),
          label.name,
        );
        if (!label.displaced)
          for (const x of [label.box.left, label.box.right])
            for (const y of [label.box.top, label.box.bottom])
              assert.ok(
                region.contain(chart.convertFromPixel({ geoIndex: 0 }, [x, y])),
                label.name,
              );
      }
    } finally {
      chart.dispose();
    }
  }
});
