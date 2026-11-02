import { createGdpIndex } from './gdp-model.mjs';

// A stale response may populate the cache, but only the latest request updates the view.
export function createGdpStore({ listDatasets, getDataset, onChange }) {
  let state = { status: 'idle', datasets: [], year: null, index: null, error: null };
  let generation = 0;
  let listing;
  const datasets = new Map();
  function publish(patch) {
    state = { ...state, ...patch };
    onChange(state);
  }
  async function load(preferredYear) {
    const request = ++generation;
    publish({ status: 'loading', year: preferredYear, index: null, error: null });
    try {
      if (!listing)
        listing = Promise.resolve()
          .then(listDatasets)
          .then((rows) => {
            if (!Array.isArray(rows) || !rows.length) throw new Error('没有可用的 GDP 年度资料');
            return [...rows].sort((a, b) => b.year - a.year);
          })
          .catch((error) => {
            listing = undefined;
            throw error;
          });
      const available = await listing;
      const year = available.some((row) => row.year === preferredYear)
        ? preferredYear
        : available[0].year;
      if (request === generation) publish({ datasets: available, year });
      if (!datasets.has(year)) {
        datasets.set(
          year,
          Promise.resolve()
            .then(() => getDataset({ year }))
            .then((dataset) => {
              if (dataset.year !== year) throw new Error('GDP 数据年份不匹配');
              return createGdpIndex(dataset);
            })
            .catch((error) => {
              datasets.delete(year);
              throw error;
            }),
        );
      }
      const index = await datasets.get(year);
      if (request === generation) publish({ status: 'ready', year, index, error: null });
    } catch (error) {
      if (request === generation) publish({ status: 'error', index: null, error });
    }
  }
  return { getState: () => state, load };
}
