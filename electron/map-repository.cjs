const fs = require('node:fs/promises');
const path = require('node:path');

const { AtlasError } = require('./errors.cjs');

async function createMapRepository(resources) {
  const catalog = JSON.parse(await fs.readFile(path.join(resources, 'catalog.json'), 'utf8'));
  const byId = new Map(catalog.map((city) => [city.id, city]));
  // Keep filesystem details on this side of the bridge.
  const cities = catalog.map(({ variants, ...city }) => city);
  return {
    listCities: () => cities,
    async getMap(request) {
      const city = request && typeof request.cityId === 'string' && byId.get(request.cityId);
      if (!city || !['districts', 'outline'].includes(request.variant)) {
        throw new AtlasError('MAP_NOT_FOUND', '未找到对应地图');
      }
      const filename = city.variants[request.variant];
      if (typeof filename !== 'string' || path.basename(filename) !== filename) {
        throw new AtlasError('MAP_UNAVAILABLE', '地图文件配置无效');
      }
      try {
        return JSON.parse(await fs.readFile(path.join(resources, 'maps', filename), 'utf8'));
      } catch {
        throw new AtlasError('MAP_UNAVAILABLE', '地图文件无法读取，请重新安装或重新生成地图资源');
      }
    },
  };
}

module.exports = { createMapRepository };
