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
      const showShare = Boolean(metric.districtParent);
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
      const total = showShare ? bars.reduce((sum, bar) => sum + bar.value, 0) : 0;
      document.getElementById('metric-chart-title').textContent =
        (showShare ? metric.districtParent + ' ' : '') +
        year +
        (showShare ? ' 年各区 ' : ' 年各省份') +
        metric.label +
        '（' +
        metric.unit +
        '）';
      key.replaceChildren(
        ...groups.map(({ label, color }) => {
          const item = document.createElement('span');
          const swatch = document.createElement('i');
          swatch.style.backgroundColor = color;
          item.append(swatch, label);
          return item;
        }),
      );
      if (showShare) key.textContent = '占比以图中各区 GDP 合计为分母';
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
        grid: { top: 27, bottom: 9, left: showShare ? 82 : 68, right: 84 },
        ...(showShare
          ? {
              tooltip: {
                trigger: 'item',
                renderMode: 'richText',
                formatter: ({ name, value }) =>
                  name + '\nGDP  ' + number.format(value) + ' ' + metric.unit,
              },
            }
          : {}),
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
              formatter: ({ value }) =>
                showShare
                  ? '{share|' + ((100 * value) / total).toFixed(2) + '%}'
                  : number.format(value),
              ...(showShare
                ? {
                    color: config.color,
                    borderColor: config.color,
                    borderWidth: 1,
                    // Rich text applies vertical padding to the glyphs in centered labels.
                    padding: [3.5, 3, -0.5, 3],
                    rich: { share: { align: 'center' } },
                    width: 44,
                  }
                : {}),
            },
            ...(showShare
              ? {
                  labelLayout: ({ rect }) => ({
                    x: chart.getWidth() - 44,
                    y: rect.y + rect.height / 2,
                    align: 'center',
                    verticalAlign: 'middle',
                  }),
                }
              : {}),
          },
        ],
      });
      observer.observe(plot);
    },
  };
}
