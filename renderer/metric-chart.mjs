export function createMetricChart(document, echarts) {
  const dialog = document.getElementById('metric-chart-dialog');
  const plot = document.getElementById('metric-chart');
  const key = document.getElementById('metric-chart-key');
  const order = document.getElementById('metric-chart-order');
  let chart;
  let bars;
  const observer = new ResizeObserver(() => chart?.resize());
  order.addEventListener('change', () => {
    if (!chart) return;
    const sorted = [...bars];
    if (order.value === 'desc') sorted.sort((a, b) => b.value - a.value);
    if (order.value === 'asc') sorted.sort((a, b) => a.value - b.value);
    chart.setOption({
      yAxis: { data: sorted.map(({ name }) => name) },
      series: [{ data: sorted }],
    });
    dialog.querySelector('.metric-chart-scroll').scrollTop = 0;
  });
  document.getElementById('metric-chart-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    observer.disconnect();
    chart?.dispose();
    chart = undefined;
    bars = undefined;
  });

  return {
    open(year, metric, regions) {
      if (dialog.open || chart) return;
      const config = metric.chart;
      const names = new Map(regions.map(({ id, name }) => [id, name]));
      const groups = config.groups ?? [];
      const colors = new Map(
        groups.flatMap(({ color, regionIds }) => regionIds.map((id) => [id, color])),
      );
      bars = config.regionIds.map((id) => ({
        name: names.get(id),
        value: metric.records.get(id).value,
        itemStyle: { color: colors.get(id) ?? config.color },
      }));
      const number = new Intl.NumberFormat('zh-CN', {
        useGrouping: false,
        maximumFractionDigits: config.fractionDigits,
      });
      document.getElementById('metric-chart-title').textContent =
        year + ' 年各省份' + metric.label + '（' + metric.unit + '）';
      key.replaceChildren(
        ...groups.map(({ label, color }) => {
          const item = document.createElement('span');
          const swatch = document.createElement('i');
          swatch.style.backgroundColor = color;
          item.append(swatch, label);
          return item;
        }),
      );
      order.value = 'source';
      // The source plots fit 31 categories in roughly 530 CSS pixels.
      plot.style.height = 36 + bars.length * 17 + 'px';
      dialog.querySelector('.metric-chart-scroll').scrollTop = 0;
      dialog.showModal();
      chart = echarts.init(plot);
      chart.setOption({
        animation: false,
        aria: { enabled: true },
        textStyle: { fontFamily: 'Microsoft YaHei, sans-serif' },
        grid: { top: 27, bottom: 9, left: 68, right: 84 },
        xAxis: {
          type: 'value',
          position: 'top',
          min: 0,
          max: config.max,
          interval: config.interval,
          splitLine: { lineStyle: { color: '#e1e7eb' } },
        },
        yAxis: {
          type: 'category',
          data: bars.map(({ name }) => name),
          inverse: true,
          axisTick: { show: false },
          axisLabel: { interval: 0 },
        },
        series: [
          {
            type: 'bar',
            data: bars,
            barWidth: 100 / (1 + (config.gapWidth ?? 60) / 100) + '%',
            label: {
              show: true,
              position: 'right',
              formatter: ({ value }) => number.format(value),
            },
          },
        ],
      });
      observer.observe(plot);
    },
  };
}
