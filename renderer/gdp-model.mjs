// Pure data-to-map projection. Missing values never inherit an ancestor total.
export const GDP_STATUS = Object.freeze({
  preliminary: '初步核算',
  final: '最终核实',
  'as-published': '公布值',
});
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 });
export const formatGdp = (value) => number.format(value);

export function createGdpIndex(dataset) {
  return {
    dataset,
    records: new Map(dataset.records.map((row) => [row.regionId, row])),
    exclusions: new Map(dataset.exclusions.map((row) => [row.regionId, row.reason])),
  };
}
function observation(index, regionId) {
  const record = index.records.get(regionId);
  const reason = index.exclusions.get(regionId) || record?.scopeNote;
  if (reason) return { status: 'excluded', reason, record };
  return record ? { status: 'available', record } : { status: 'missing' };
}
export function buildGdpModel(index, region, geoJSON, variant) {
  const { dataset } = index;
  const children = new Map(region.children.map((child) => [child.name, child.regionId]));
  const names = [
    ...new Set(
      geoJSON.features
        .filter((feature) => ['Polygon', 'MultiPolygon'].includes(feature.geometry.type))
        .map((feature) => feature.properties.name),
    ),
  ];
  const areas = names.map((name) => {
    const id = variant === 'outline' || !region.children.length ? region.id : children.get(name);
    return { name, regionId: id || null, ...observation(index, id) };
  });
  const thresholds =
    region.level === 'country' ? [10000, 30000, 60000, 100000] : [500, 1000, 3000, 10000];
  const choropleth = variant === 'districts' && region.children.length > 0;
  return {
    year: dataset.year,
    unit: dataset.unit,
    retrievedOn: dataset.retrievedOn,
    current: observation(index, region.id),
    areas,
    choropleth,
    thresholds,
    covered: areas.filter((area) => area.status === 'available').length,
    total: areas.length,
  };
}
export function gdpTooltip(model, name) {
  const area = model.areas.find((area) => area.name === name);
  if (!area) return name;
  if (area.status === 'missing') return name + '\n' + model.year + ' 年 GDP：暂无数据';
  if (area.status === 'excluded') return name + '\n统计范围待核实\n' + area.reason;
  const { record } = area;
  return (
    name +
    '\n' +
    model.year +
    ' 年 GDP  ' +
    formatGdp(record.value) +
    ' ' +
    model.unit +
    '\n现价 · ' +
    GDP_STATUS[record.status] +
    '\n' +
    record.source.publisher
  );
}
// Fixed ranges by administrative level keep sibling maps comparable.
function mix(color, target, weight) {
  const parts = color.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16));
  return (
    '#' +
    parts
      .map((part, i) =>
        Math.round(part + (target[i] - part) * weight)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function gdpColors(fill) {
  return [
    mix(fill, [255, 255, 255], 0.9),
    mix(fill, [255, 255, 255], 0.7),
    mix(fill, [255, 255, 255], 0.45),
    mix(fill, [255, 255, 255], 0.2),
    fill,
  ];
}
export const GDP_MISSING_COLOR = '#e5e3df';
export function gdpClass(value, thresholds) {
  return thresholds.filter((threshold) => value >= threshold).length;
}
export function gdpRangeLabels(thresholds) {
  return [
    '< ' + formatGdp(thresholds[0]),
    ...thresholds
      .slice(0, -1)
      .map((value, i) => formatGdp(value) + '–' + formatGdp(thresholds[i + 1])),
    '≥ ' + formatGdp(thresholds.at(-1)),
  ];
}
