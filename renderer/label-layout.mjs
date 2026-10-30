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

function segmentHitsBox(a, b, box) {
  let start = 0,
    end = 1;
  for (let axis = 0; axis < 2; axis++) {
    const min = axis ? box.top : box.left,
      max = axis ? box.bottom : box.right;
    const delta = b[axis] - a[axis];
    if (delta === 0) {
      if (a[axis] < min || a[axis] > max) return false;
    } else {
      const t1 = (min - a[axis]) / delta,
        t2 = (max - a[axis]) / delta;
      start = Math.max(start, Math.min(t1, t2));
      end = Math.min(end, Math.max(t1, t2));
      if (start > end) return false;
    }
  }
  return true;
}

// Spatial buckets keep external-label searches independent of total coastline complexity.
function boundaryIndex(regions, viewport, lines) {
  const buckets = new Map(),
    size = 32;
  function cells(box, visit) {
    const left = Math.max(viewport.left, box.left),
      right = Math.min(viewport.right, box.right);
    const top = Math.max(viewport.top, box.top),
      bottom = Math.min(viewport.bottom, box.bottom);
    for (let x = Math.floor(left / size); x <= Math.floor(right / size); x++)
      for (let y = Math.floor(top / size); y <= Math.floor(bottom / size); y++) visit(x + ':' + y);
  }
  function addLine(ring) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1],
        b = ring[i];
      cells(
        {
          left: Math.min(a[0], b[0]),
          right: Math.max(a[0], b[0]),
          top: Math.min(a[1], b[1]),
          bottom: Math.max(a[1], b[1]),
        },
        (key) => {
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push([a, b]);
        },
      );
    }
  }
  for (const region of regions)
    for (const polygon of region.polygons) for (const ring of polygon) addLine([...ring, ring[0]]);
  for (const line of lines) addLine(line);
  return (box) => {
    let hit = false;
    cells(box, (key) => {
      if (!hit) hit = (buckets.get(key) || []).some(([a, b]) => segmentHitsBox(a, b, box));
    });
    return hit;
  };
}

export function layoutRegionLabels(
  regions,
  { width, height, measureText, reserved = [], lines = [] },
) {
  const viewport = { left: 10, right: width - 10, top: 10, bottom: height - 10 };
  const occupied = [...reserved],
    labels = [],
    outside = [],
    leaderLines = [];
  const hitsBoundary = boundaryIndex(regions, viewport, lines);
  const fits = (box) =>
    box.left >= viewport.left &&
    box.right <= viewport.right &&
    box.top >= viewport.top &&
    box.bottom <= viewport.bottom &&
    !occupied.some((other) => intersects(box, other, 3)) &&
    !leaderLines.some(([a, b]) => segmentHitsBox(a, b, box));
  for (const region of regions) {
    const textWidth = measureText(region.name) + 8,
      textHeight = 20;
    const point = interiorPoint(region.polygons, textWidth, textHeight, viewport);
    if (!point) continue; // The region is completely outside the current view.
    const box = boxAt(point.x, point.y, textWidth, textHeight);
    const label = { name: region.name, x: point.x, y: point.y, anchor: [point.x, point.y], box };
    if (point.d >= 1.04 && fits(box) && !hitsBoundary(box)) {
      occupied.push(box);
      labels.push(label);
    } else outside.push({ ...label, textWidth, textHeight });
  }
  outside.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const label of outside) {
    let best;
    for (let radius = 12; radius <= 250; radius += 12) {
      for (let i = 0; i < 24; i++) {
        const angle = (i * Math.PI) / 12;
        const x = label.anchor[0] + Math.cos(angle) * (radius + label.textWidth / 2);
        const y = label.anchor[1] + Math.sin(angle) * (radius + label.textHeight / 2);
        const box = boxAt(x, y, label.textWidth, label.textHeight);
        if (!fits(box) || hitsBoundary(box)) continue;
        const end = [
          Math.max(box.left, Math.min(box.right, label.anchor[0])),
          Math.max(box.top, Math.min(box.bottom, label.anchor[1])),
        ];
        if (occupied.some((other) => segmentHitsBox(label.anchor, end, other))) continue;
        const score = Math.hypot(x - label.anchor[0], y - label.anchor[1]);
        if (!best || score < best.score)
          best = { ...label, x, y, box, line: [label.anchor, end], score };
      }
      if (best) break;
    }
    if (best) {
      leaderLines.push(best.line);
      occupied.push(best.box);
      labels.push(best);
    }
  }
  return labels;
}
