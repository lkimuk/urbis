const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { AtlasError } = require('./errors.cjs');

const validDate = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const validYear = (year) => Number.isInteger(year) && year >= 1900 && year <= 2100;

// One contract for generated resources and the main-process API. No research files cross IPC.
function validateGdpDataset(dataset, catalog) {
  const invalid = () => {
    throw new Error('Invalid GDP dataset');
  };
  if (
    !dataset ||
    dataset.schemaVersion !== 1 ||
    !validYear(dataset.year) ||
    dataset.unit !== '亿元' ||
    dataset.currency !== 'CNY' ||
    dataset.priceBasis !== 'current' ||
    !validDate(dataset.retrievedOn) ||
    !Array.isArray(dataset.records) ||
    !Array.isArray(dataset.exclusions)
  )
    invalid();
  const regions = new Map(catalog.map((region) => [region.id, region]));
  const seen = new Set();
  for (const row of dataset.records) {
    const region = regions.get(row.regionId);
    if (
      !region ||
      region.name !== row.regionName ||
      !Number.isFinite(row.value) ||
      row.value <= 0 ||
      seen.has(row.regionId) ||
      !['preliminary', 'final', 'as-published'].includes(row.status)
    )
      invalid();
    const source = row.source;
    if (
      !source ||
      !['publisher', 'title', 'url'].every(
        (key) => typeof source[key] === 'string' && source[key].trim().length > 0,
      )
    )
      invalid();
    const url = new URL(source.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) invalid();
    if (
      source.publishedOn != null &&
      (!validDate(source.publishedOn) || source.publishedOn > dataset.retrievedOn)
    )
      invalid();
    if (row.scopeNote != null && (typeof row.scopeNote !== 'string' || !row.scopeNote.trim()))
      invalid();
    seen.add(row.regionId);
  }
  const exclusions = new Set();
  for (const row of dataset.exclusions) {
    if (
      !regions.has(row.regionId) ||
      exclusions.has(row.regionId) ||
      typeof row.reason !== 'string' ||
      !row.reason.trim()
    )
      invalid();
    exclusions.add(row.regionId);
  }
  return dataset;
}

function metadata(dataset) {
  const { year, unit, currency, priceBasis, retrievedOn } = dataset;
  return { year, unit, currency, priceBasis, retrievedOn, recordCount: dataset.records.length };
}
function validMetadata(value, year) {
  return (
    value &&
    value.year === year &&
    value.unit === '亿元' &&
    value.currency === 'CNY' &&
    value.priceBasis === 'current' &&
    validDate(value.retrievedOn) &&
    Number.isInteger(value.recordCount) &&
    value.recordCount > 0
  );
}

function createGdpRepository(resources, catalog) {
  let indexPromise;
  const pending = new Map();
  async function index() {
    if (!indexPromise) {
      indexPromise = fs
        .readFile(path.join(resources, 'gdp/index.json'), 'utf8')
        .then((raw) => {
          const value = JSON.parse(raw);
          if (value.schemaVersion !== 1 || !Array.isArray(value.datasets) || !value.datasets.length)
            throw new Error('Invalid GDP index');
          const seen = new Set();
          for (const row of value.datasets) {
            if (
              !validYear(row.year) ||
              seen.has(row.year) ||
              row.file !== row.year + '.json' ||
              !/^[a-f0-9]{64}$/.test(row.sha256) ||
              !validMetadata(row.metadata, row.year)
            )
              throw new Error('Invalid GDP index entry');
            seen.add(row.year);
          }
          return value.datasets;
        })
        .catch((error) => {
          indexPromise = undefined;
          throw error;
        });
    }
    return indexPromise;
  }
  async function get(request) {
    if (!request || !validYear(request.year) || Object.keys(request).some((key) => key !== 'year'))
      throw new AtlasError('GDP_YEAR_NOT_FOUND', '没有该年份的 GDP 数据');
    try {
      const entry = (await index()).find((row) => row.year === request.year);
      if (!entry) throw new AtlasError('GDP_YEAR_NOT_FOUND', '没有该年份的 GDP 数据');
      if (!pending.has(entry.year)) {
        pending.set(
          entry.year,
          fs
            .readFile(path.join(resources, 'gdp', entry.file))
            .then((raw) => {
              if (createHash('sha256').update(raw).digest('hex') !== entry.sha256)
                throw new Error('GDP resource checksum mismatch');
              const dataset = validateGdpDataset(JSON.parse(raw.toString('utf8')), catalog);
              if (
                Object.entries(metadata(dataset)).some(
                  ([key, value]) => value !== entry.metadata[key],
                )
              )
                throw new Error('GDP index metadata mismatch');
              return dataset;
            })
            .catch((error) => {
              pending.delete(entry.year);
              throw error;
            }),
        );
      }
      return await pending.get(entry.year);
    } catch (error) {
      if (error instanceof AtlasError) throw error;
      throw new AtlasError('GDP_UNAVAILABLE', 'GDP 数据无法读取，请重试或重新安装应用');
    }
  }
  return {
    async list() {
      try {
        return (await index()).map((row) => ({ ...row.metadata }));
      } catch {
        throw new AtlasError('GDP_UNAVAILABLE', 'GDP 数据目录无法读取，请重试或重新安装应用');
      }
    },
    get,
  };
}
module.exports = { createGdpRepository, validateGdpDataset, metadata };
