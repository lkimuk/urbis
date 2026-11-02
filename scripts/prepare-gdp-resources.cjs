const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateGdpDataset, metadata } = require('../electron/gdp-repository.cjs');

// Package only explicitly enabled annual snapshots. Historical coverage differs; never blend years.
function prepareGdpResources(dataDirectory, outputDirectory, catalog) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDirectory, name), 'utf8'));
  const config = read('map-scope.json');
  if (!Array.isArray(config.datasets) || !config.datasets.length)
    throw new Error('No GDP datasets configured');
  const generated = [];
  const years = new Set();
  for (const { year, exclusions } of config.datasets) {
    if (!Number.isInteger(year) || year < 1900 || year > 2100 || years.has(year))
      throw new Error('Invalid or duplicate GDP year');
    years.add(year);
    const snapshot = read('gdp-' + year + '.json');
    const manifest = read('manifest-' + year + '.json');
    if (snapshot.year !== year || manifest.year !== year) throw new Error('GDP year mismatch');
    if (
      ['unit', 'currency', 'priceBasis', 'retrievedOn'].some(
        (key) => snapshot[key] !== manifest[key],
      )
    )
      throw new Error('GDP metadata mismatch');
    for (const [filename, expected] of Object.entries(manifest.files)) {
      if (path.basename(filename) !== filename) throw new Error('Invalid GDP source filename');
      const raw = fs.readFileSync(path.join(dataDirectory, 'sources', filename));
      if (createHash('sha256').update(raw).digest('hex') !== expected)
        throw new Error('GDP source changed: ' + filename);
    }
    const sources = new Map(manifest.sources.map((source) => [source.id, source]));
    if (sources.size !== manifest.sources.length || sources.size !== snapshot.records.length)
      throw new Error('GDP source/observation count mismatch');
    const records = snapshot.records.map((row) => {
      const source = sources.get(row.sourceId);
      const region = catalog.find((region) => region.id === row.regionId);
      if (
        !source ||
        source.regionId !== row.regionId ||
        source.regionName !== row.regionName ||
        source.year !== year ||
        Number(source.value) !== row.value ||
        source.status !== row.status ||
        source.file !== row.sourceFile ||
        !Object.hasOwn(manifest.files, source.file) ||
        source.publishedOn !== row.publishedOn ||
        source.scopeNote !== row.scopeNote ||
        !region ||
        region.level !== row.level ||
        (source.parentId && source.parentId !== region.parentId)
      )
        throw new Error('GDP snapshot/manifest mismatch: ' + row.regionId);
      return {
        regionId: row.regionId,
        regionName: row.regionName,
        value: row.value,
        status: row.status,
        source: {
          publisher: source.publisher,
          title: source.title,
          url: source.publicationUrl || source.url,
          publishedOn: source.publishedOn,
        },
        ...(row.scopeNote || source.scopeNote
          ? { scopeNote: row.scopeNote || source.scopeNote }
          : {}),
      };
    });
    const dataset = validateGdpDataset(
      {
        schemaVersion: 1,
        year,
        unit: snapshot.unit,
        currency: snapshot.currency,
        priceBasis: snapshot.priceBasis,
        retrievedOn: snapshot.retrievedOn,
        records,
        exclusions,
      },
      catalog,
    );
    const raw = JSON.stringify(dataset) + '\n';
    generated.push({
      raw,
      entry: {
        year,
        file: year + '.json',
        sha256: createHash('sha256').update(raw).digest('hex'),
        metadata: metadata(dataset),
      },
    });
  }
  // Validate everything before replacing any generated resource. Index is published last.
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const { raw, entry } of generated)
    fs.writeFileSync(path.join(outputDirectory, entry.file), raw);
  const index = {
    schemaVersion: 1,
    datasets: generated.map((item) => item.entry).sort((a, b) => b.year - a.year),
  };
  fs.writeFileSync(path.join(outputDirectory, 'index.json'), JSON.stringify(index) + '\n');
  return index.datasets.map((row) => row.metadata);
}
module.exports = { prepareGdpResources };
