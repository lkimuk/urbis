export const PALETTES = Object.freeze({
  atlas: Object.freeze({ fill: '#b8cdbe', border: '#526d60', background: '#faf9f5' }),
  clay: Object.freeze({ fill: '#d7b399', border: '#8a5a42', background: '#fbf6ef' }),
  ink: Object.freeze({ fill: '#b6c5d3', border: '#435c75', background: '#f4f6f8' }),
});

export const DEFAULTS = Object.freeze({
  variant: 'districts',
  labels: true,
  showTitle: true,
  ...PALETTES.atlas,
  width: 1,
  scale: 2,
  transparent: false,
  palette: 'atlas',
  cityId: '',
  title: '',
});

export function normalizeSettings(value) {
  const result = { ...DEFAULTS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of ['labels', 'showTitle', 'transparent']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  for (const key of ['fill', 'border', 'background']) {
    if (typeof value[key] === 'string' && /^#[a-f0-9]{6}$/i.test(value[key]))
      result[key] = value[key];
  }
  if (['districts', 'outline'].includes(value.variant)) result.variant = value.variant;
  if ([1, 2, 3, 4].includes(value.scale)) result.scale = value.scale;
  if (Number.isFinite(value.width) && value.width >= 0.3 && value.width <= 3)
    result.width = value.width;
  if (value.palette === '' || Object.hasOwn(PALETTES, value.palette))
    result.palette = value.palette;
  if (typeof value.cityId === 'string') result.cityId = value.cityId;
  if (typeof value.title === 'string') result.title = value.title.slice(0, 40);
  return result;
}

export function loadSettings(storage) {
  try {
    return normalizeSettings(JSON.parse(storage.getItem('city-atlas')));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(storage, settings) {
  try {
    storage.setItem('city-atlas', JSON.stringify(normalizeSettings(settings)));
  } catch {
    /* Preferences are optional when storage is unavailable. */
  }
}
