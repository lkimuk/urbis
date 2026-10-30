const normalize = (value) => value.trim().toLowerCase().replaceAll('台', '臺').replaceAll(' ', '');

export function filterRegions(regions, { query = '', province = '', level = '' } = {}) {
  const needle = normalize(query);
  return regions.filter(
    (region) =>
      (!level || region.level === level) &&
      (!province || region.province === province) &&
      (!needle ||
        [
          region.name,
          region.province,
          region.city || '',
          region.pinyin || '',
          region.initials || '',
        ].some((value) => normalize(value).includes(needle))),
  );
}

export function resolveRegion(regions, id) {
  return (
    regions.find((region) => region.id === id) ||
    regions.find((region) => region.aliases?.includes(id)) ||
    regions.find((region) => region.level === 'country')
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

// Share only in-flight reads; completed maps belong to the current view.
// Only the latest request is presented, even when requests finish out of order.
export function createMapLoader(getMap) {
  const pendingMaps = new Map();
  let version = 0;
  return async function load(regionId, variant) {
    const request = ++version;
    const key = regionId + '-' + variant;
    if (!pendingMaps.has(key)) {
      pendingMaps.set(
        key,
        Promise.resolve().then(() => getMap({ regionId, variant })),
      );
    }
    const pending = pendingMaps.get(key);
    try {
      const geoJSON = await pending;
      return request === version ? { key, geoJSON } : null;
    } catch (error) {
      if (request !== version) return null;
      throw error;
    } finally {
      if (pendingMaps.get(key) === pending) pendingMaps.delete(key);
    }
  };
}
