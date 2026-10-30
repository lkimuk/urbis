const normalize = (value) => value.trim().toLowerCase().replaceAll('台', '臺').replaceAll(' ', '');

export function filterCities(cities, { query = '', province = '' } = {}) {
  const needle = normalize(query);
  return cities.filter(
    (city) =>
      (!province || city.province === province) &&
      (!needle ||
        [city.name, city.province, city.pinyin, city.initials].some((value) =>
          normalize(value).includes(needle),
        )),
  );
}

// Rejected promises are removed so a transient failure can be retried.
// Only the latest request is presented, even when requests finish out of order.
export function createMapLoader(getMap) {
  const cache = new Map();
  let version = 0;
  return async function load(cityId, variant) {
    const request = ++version;
    const key = cityId + '-' + variant;
    if (!cache.has(key)) {
      const pending = Promise.resolve().then(() => getMap({ cityId, variant }));
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
