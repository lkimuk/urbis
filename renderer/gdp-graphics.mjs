import {
  formatGdp,
  gdpColors,
  gdpRangeLabels,
  GDP_MISSING_COLOR,
  GDP_STATUS,
} from './gdp-model.mjs';

// Screen and PNG share these annotations; label placement reserves their screen space.
export function gdpGraphics(model, settings, width, height) {
  if (!model) return { elements: [], reserved: [], bottom: '10%' };
  const elements = [];
  const left = 30;
  const font = '11px "Microsoft YaHei", sans-serif';
  function text(id, value, x, y, size = 11) {
    elements.push({
      id,
      type: 'text',
      silent: true,
      z: 30,
      style: {
        text: value,
        x,
        y,
        fill: settings.text,
        font: size === 11 ? font : size + 'px "Microsoft YaHei", sans-serif',
        verticalAlign: 'top',
      },
    });
  }
  function swatch(id, color, x, y) {
    elements.push({
      id,
      type: 'rect',
      silent: true,
      z: 30,
      shape: { x, y, width: 12, height: 9 },
      style: { fill: color, stroke: settings.border, lineWidth: 0.4 },
    });
  }
  const columns = width < 680 ? 3 : 5;
  const rows = Math.ceil(5 / columns);
  const footerHeight = model.choropleth && model.covered > 0 ? 96 + (rows - 1) * 22 : 65;
  const y = height - footerHeight;
  text(
    'gdp-heading',
    model.year + ' 年 ' + model.label + ' · ' + model.unit + ' · ' + model.basis,
    left,
    y,
  );
  if (model.choropleth && model.covered > 0) {
    const labels = gdpRangeLabels(model.thresholds),
      colors = gdpColors(settings.fill);
    const column = (width - 60) / columns;
    labels.forEach((label, i) => {
      const x = left + (i % columns) * column;
      const row = Math.floor(i / columns) * 22;
      swatch('gdp-swatch-' + i, colors[i], x, y + 25 + row);
      text('gdp-range-' + i, label, x + 17, y + 24 + row, 10);
    });
    if (model.covered < model.total) {
      swatch('gdp-missing', GDP_MISSING_COLOR, left, y + 26 + rows * 22);
      text(
        'gdp-coverage',
        '暂无可用数据 ' + (model.total - model.covered) + '/' + model.total,
        left + 18,
        y + 25 + rows * 22,
      );
    }
    const statuses = [
      ...new Set(
        model.areas
          .filter((area) => area.status === 'available')
          .map((area) => GDP_STATUS[area.record.status]),
      ),
    ];
    const source = model.metricId === 'gdp' ? '各地统计部门' : '用户工作簿';
    text('gdp-basis', '来源：' + source + ' · ' + statuses.join(' / '), left, height - 22, 10);
  } else {
    const current = model.current;
    text(
      'gdp-total',
      current.status === 'available'
        ? (model.metricId === 'gdp' ? '总量  ' : '') +
            formatGdp(current.record.value) +
            ' ' +
            model.unit
        : current.status === 'excluded'
          ? '统计范围待核实'
          : '暂无数据',
      left,
      y + 23,
      12,
    );
    text(
      'gdp-basis',
      model.choropleth
        ? '下辖地区暂无可用数据'
        : current.status === 'available'
          ? current.record.source.publisher + ' · ' + GDP_STATUS[current.record.status]
          : current.status === 'excluded'
            ? '地图边界与统计范围尚未确认一致'
            : '未收录该年度数据',
      left,
      height - 22,
      10,
    );
  }
  return {
    elements,
    reserved: [{ left: 16, top: y - 12, right: width - 16, bottom: height }],
    bottom: footerHeight + 30,
  };
}
