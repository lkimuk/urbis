import { formatGdp, GDP_STATUS } from './gdp-model.mjs';

// DOM presentation only. Values, eligibility and geometry matching belong to gdp-model.
export function createGdpPanel(document) {
  const element = (id) => document.getElementById(id);
  let previousModel;
  function paragraph(text, className = '') {
    const node = document.createElement('p');
    node.textContent = text;
    node.className = className;
    return node;
  }
  function sourceSection(name, observation, unit) {
    const section = document.createElement('section');
    section.className = 'gdp-source';
    const heading = document.createElement('strong');
    heading.textContent = name;
    section.append(heading);
    if (observation.status === 'excluded') section.append(paragraph(observation.reason));
    if (observation.record) {
      const record = observation.record;
      section.append(
        paragraph(formatGdp(record.value) + ' ' + unit + ' · ' + GDP_STATUS[record.status]),
        paragraph(
          record.source.publisher +
            (record.source.publishedOn ? ' · ' + record.source.publishedOn : ''),
        ),
        paragraph(record.source.title),
      );
      if (record.source.url) section.append(paragraph(record.source.url, 'gdp-source-url'));
    } else if (observation.status === 'missing') section.append(paragraph('暂无数据'));
    return section;
  }
  return {
    render({ enabled, state, model, region, preferredMetric }) {
      element('gdp-controls').hidden = !enabled;
      if (!enabled) return;
      const year = element('gdp-year');
      const values = state.datasets.map((row) => String(row.year));
      if ([...year.options].map((option) => option.value).join() !== values.join()) {
        year.replaceChildren(
          ...values.map((value) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            return option;
          }),
        );
      }
      year.value = state.year == null ? '' : String(state.year);
      year.disabled = !values.length;
      const selector = element('gdp-metric');
      const metrics = [
        { id: 'gdp', label: '地区生产总值（GDP）' },
        ...(state.index?.metrics.values() ?? []),
      ];
      if (
        metrics.some(
          ({ id, label }, i) =>
            selector.options[i]?.value !== id || selector.options[i]?.textContent !== label,
        ) ||
        selector.options.length !== metrics.length
      ) {
        selector.replaceChildren(
          ...metrics.map(({ id, label }) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = label;
            return option;
          }),
        );
      }
      selector.value = metrics.some(({ id }) => id === preferredMetric) ? preferredMetric : 'gdp';
      selector.disabled = state.status !== 'ready';
      element('gdp-state').classList.toggle('error', state.status === 'error');
      element('gdp-state').textContent =
        state.status === 'error'
          ? state.error.message
          : state.status !== 'ready'
            ? '正在读取年度指标…'
            : !model
              ? '等待地图就绪'
              : model.choropleth
                ? '已收录 ' +
                  model.covered +
                  '/' +
                  model.total +
                  ' 个分区 · ' +
                  model.basis +
                  '，' +
                  model.unit
                : model.current.status === 'available'
                  ? formatGdp(model.current.record.value) + ' ' + model.unit + ' · ' + model.basis
                  : model.current.status === 'excluded'
                    ? '统计范围待核实'
                    : '该地区暂无数据';
      element('gdp-retry').hidden = state.status !== 'error';
      element('gdp-details').hidden = !model;
      if (previousModel === model) return;
      previousModel = model;
      element('gdp-sources').replaceChildren();
      if (!model) return;
      const content = document.createDocumentFragment();
      content.append(
        paragraph(
          model.metricId === 'gdp'
            ? '采用所存年度发布版本，未保证涵盖全部后续修订。资料获取：' + model.retrievedOn + '。'
            : model.label + ' · ' + model.basis,
        ),
      );
      content.append(sourceSection(region.name, model.current, model.unit));
      for (const area of model.areas) {
        if (area.regionId === region.id || area.status === 'missing') continue;
        content.append(sourceSection(area.name, area, model.unit));
      }
      element('gdp-sources').append(content);
    },
  };
}
