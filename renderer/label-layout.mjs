// Pure screen-space layout. Geometry, text measurement and drawing stay with the caller.
const intersects = (a, b, gap = 0) =>
  a.left < b.right + gap &&
  a.right + gap > b.left &&
  a.top < b.bottom + gap &&
  a.bottom + gap > b.top;
const boxAt = (x, y, width, height) => ({
  left: x - width / 2,
  right: x + width / 2,
  top: y - height / 2,
  bottom: y + height / 2,
});

function contains(rings, x, y) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
        inside = !inside;
    }
  }
  return inside;
}

// Distance in a metric scaled to the label rectangle, including polygon holes.
// A clearance of 1 means the complete padded text rectangle fits inside the shape.
function clearance(rings, x, y) {
  let distance = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = ring[j][0] - x,
        ay = ring[j][1] - y;
      const bx = ring[i][0] - x,
        by = ring[i][1] - y;
      const dx = bx - ax,
        dy = by - ay;
      let d = Math.min(Math.max(Math.abs(ax), Math.abs(ay)), Math.max(Math.abs(bx), Math.abs(by)));
      for (const t of [(ay - ax) / (dx - dy), -(ax + ay) / (dx + dy)]) {
        if (t > 0 && t < 1) d = Math.min(d, Math.max(Math.abs(ax + t * dx), Math.abs(ay + t * dy)));
      }
      distance = Math.min(distance, d);
    }
  }
  return contains(rings, x, y) ? distance : -distance;
}

function push(heap, cell) {
  let i = heap.length;
  heap.push(cell);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].max >= cell.max) break;
    heap[i] = heap[parent];
    i = parent;
  }
  heap[i] = cell;
}

function pop(heap) {
  const first = heap[0],
    last = heap.pop();
  if (!heap.length) return first;
  let i = 0;
  while (2 * i + 1 < heap.length) {
    let child = 2 * i + 1;
    if (child + 1 < heap.length && heap[child + 1].max > heap[child].max) child++;
    if (last.max >= heap[child].max) break;
    heap[i] = heap[child];
    i = child;
  }
  heap[i] = last;
  return first;
}

function interiorPoint(polygons, width, height, viewport) {
  const sx = width / 2,
    sy = height / 2;
  let best;
  for (const polygon of polygons) {
    const rings = polygon.map((ring) => ring.map(([x, y]) => [x / sx, y / sy]));
    const outer = rings[0];
    if (!outer?.length) continue;
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (const [x, y] of outer) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    left = Math.max(left, viewport.left / sx);
    right = Math.min(right, viewport.right / sx);
    top = Math.max(top, viewport.top / sy);
    bottom = Math.min(bottom, viewport.bottom / sy);
    if (left >= right || top >= bottom) continue;
    const heap = [];
    const add = (x, y, hx, hy) => {
      const d = clearance(rings, x, y);
      const cell = { x, y, hx, hy, d, max: d + Math.max(hx, hy) };
      push(heap, cell);
      if (d > 0 && (!best || d > best.d)) best = { x: x * sx, y: y * sy, d };
    };
    add((left + right) / 2, (top + bottom) / 2, (right - left) / 2, (bottom - top) / 2);
    for (let steps = 0; heap.length && steps < 1500; steps++) {
      const cell = pop(heap);
      if (cell.max <= (best?.d || 0) + 0.04) continue;
      const { x, y } = cell,
        hx = cell.hx / 2,
        hy = cell.hy / 2;
      add(x - hx, y - hy, hx, hy);
      add(x + hx, y - hy, hx, hy);
      add(x - hx, y + hy, hx, hy);
      add(x + hx, y + hy, hx, hy);
    }
  }
  return best;
}

// Small labels take nearby slots first; larger regions have space to yield to them.
// Offsets are intentionally bounded: without leader lines a distant name is misleading.
export function layoutRegionLabels(regions, { width, height, measureText, reserved = [] }) {
  const viewport = { left: 10, right: width - 10, top: 10, bottom: height - 10 };
  const occupied = [...reserved],
    labels = [];
  const candidates = regions.flatMap((region) => {
    const textWidth = measureText(region.name) + 8,
      textHeight = 20;
    const point = interiorPoint(region.polygons, textWidth, textHeight, viewport);
    return point
      ? [
          {
            name: region.name,
            anchor: [point.x, point.y],
            textWidth,
            textHeight,
            clearance: point.d,
          },
        ]
      : [];
  });
  candidates.sort((a, b) => a.clearance - b.clearance || a.anchor[0] - b.anchor[0]);
  for (const label of candidates) {
    const [ax, ay] = label.anchor;
    const neighbor = candidates
      .filter(
        (other) =>
          other !== label &&
          Math.abs(other.anchor[0] - ax) < (label.textWidth + other.textWidth) / 2 &&
          Math.abs(other.anchor[1] - ay) < 24,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.anchor[0] - ax, a.anchor[1] - ay) -
          Math.hypot(b.anchor[0] - ax, b.anchor[1] - ay),
      )[0];
    const direction = neighbor && ax <= neighbor.anchor[0] ? -1 : 1;
    const offsets =
      label.clearance < 1.04 && neighbor
        ? [
            [0, direction * 12],
            [0, 0],
          ]
        : [[0, 0]];
    for (const distance of [12, 24, 36]) {
      offsets.push([0, direction * distance], [0, -direction * distance]);
      for (const dx of [-12, 12])
        offsets.push([dx, direction * distance], [dx, -direction * distance]);
    }
    offsets.push([-24, 0], [24, 0], [-36, 0], [36, 0]);
    for (const [dx, dy] of offsets) {
      const x = ax + dx,
        y = ay + dy,
        box = boxAt(x, y, label.textWidth, label.textHeight);
      if (
        box.left < viewport.left ||
        box.right > viewport.right ||
        box.top < viewport.top ||
        box.bottom > viewport.bottom ||
        occupied.some((other) => intersects(box, other, 3))
      )
        continue;
      const displaced = label.clearance < 1.04 || dx !== 0 || dy !== 0;
      labels.push({ name: label.name, x, y, anchor: label.anchor, box, displaced });
      occupied.push(box);
      break;
    }
  }
  return labels;
}
