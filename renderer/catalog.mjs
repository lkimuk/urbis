const normalize = (value) => value.trim().toLowerCase().replaceAll('台', '臺').replaceAll(' ', '');

export function filterRegions(regions, { query = '', province = '', level = '' } = {}) {
  const needle = normalize(query);
  return regions.filter(
    (region) =>
      (!level || region.level === level) &&
      (!province || region.province === province) &&
      (!needle ||
        [region.name, region.province, region.city || '', region.pinyin, region.initials].some(
          (value) => normalize(value).includes(needle),
        )),
  );
}

export function regionTrail(regions, region) {
  const byId = new Map(regions.map((item) => [item.id, item]));
  const trail = [];
  const visited = new Set();
  while (region && !visited.has(region.id)) {
    visited.add(region.id);
    trail.unshift(region);
    region = byId.get(region.parentId);
  }
  return trail;
}

export function childRegion(regions, parent, name) {
  const id = parent.children.find((child) => child.name === name)?.regionId;
  return regions.find((region) => region.id === id);
}

// Rejected promises are removed so a transient failure can be retried.
// Only the latest request is presented, even when requests finish out of order.
export function createMapLoader(getMap) {
  const cache = new Map();
  let version = 0;
  return async function load(regionId, variant) {
    const request = ++version;
    const key = regionId + '-' + variant;
    if (!cache.has(key)) {
      const pending = Promise.resolve().then(() => getMap({ regionId, variant }));
      cache.set(key, pending);
      pending.catch(() => {
        if (cache.get(key) === pending) cache.delete(key);
      });
    }
    try {
      const geoJSON = await cache.get(key);
      return request === version ? { key, geoJSON } : null;
    } catch (error) {
      if (request !== version) return null;
      throw error;
    }
  };
}
