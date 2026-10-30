// This module owns ECharts and its canvas. It has no knowledge of form controls or IPC.
export function createMapView({ echarts, element, onSelect, onResize }) {
  const chart = echarts.init(element, null, {
    renderer: 'canvas',
    devicePixelRatio: window.devicePixelRatio,
  });
  const regions = new Map();
  let model;
  let layoutFrame;

  function layoutLabels() {
    if (!model || model.settings.variant !== 'districts' || !model.settings.labels) return;
    const occupied = [];
    const data = regions.get(model.key).map((region) => {
      const [x, y] = chart.convertToPixel({ seriesIndex: 0 }, region.getCenter());
      const width = Array.from(region.name).length * 11 + 8;
      const box = { left: x - width / 2, right: x + width / 2, top: y - 9, bottom: y + 9 };
      const show = !occupied.some(
        (other) =>
          box.left < other.right &&
          box.right > other.left &&
          box.top < other.bottom &&
          box.bottom > other.top,
      );
      if (show) occupied.push(box);
      return { name: region.name, label: { show } };
    });
    chart.setOption({ series: [{ id: 'region', data }] });
  }

  function render({ region, key, settings }, reset = false) {
    const previous = reset ? null : chart.getOption()?.series?.[0];
    model = { region, key, settings };
    chart.setOption(
      {
        animation: false,
        backgroundColor: settings.transparent ? 'transparent' : settings.background,
        title: {
          show: settings.showTitle,
          text: settings.title.trim() || region.name,
          subtext:
            ({ country: '全国', province: '省级地图', city: region.province }[region.level] ||
              region.province) +
            '  /  ' +
            (settings.variant === 'districts' ? '行政区划' : '区域轮廓'),
          left: 30,
          top: 25,
          textStyle: {
            color: settings.border,
            fontFamily: 'SimSun, serif',
            fontSize: 25,
            fontWeight: 'normal',
          },
          subtextStyle: { color: settings.border, fontFamily: 'Microsoft YaHei', fontSize: 10 },
          itemGap: 12,
        },
        tooltip: {
          trigger: 'item',
          confine: true,
          renderMode: 'richText',
          formatter: (params) => params.name,
          backgroundColor: '#f9f8f1',
          borderColor: '#c3cdbb',
          textStyle: { color: '#314b39', fontSize: 12 },
        },
        series: [
          {
            id: 'region',
            type: 'map',
            map: key,
            roam: true,
            selectedMode: 'single',
            scaleLimit: { min: 0.5, max: 12 },
            zoom: previous?.zoom || 1,
            ...(previous?.center ? { center: previous.center } : {}),
            left: '10%',
            right: '10%',
            top: settings.showTitle ? 125 : '10%',
            bottom: '10%',
            label: {
              show: settings.labels && settings.variant === 'districts',
              color: settings.border,
              fontSize: 11,
              fontFamily: 'Microsoft YaHei',
            },
            itemStyle: {
              areaColor: settings.fill,
              borderColor: settings.border,
              borderWidth: settings.width,
            },
            emphasis: {
              label: {
                show: settings.variant === 'districts' && settings.labels,
                color: settings.border,
              },
              itemStyle: { areaColor: settings.fill, shadowBlur: 8, shadowColor: '#29463833' },
            },
            select: {
              label: { color: settings.border },
              itemStyle: {
                areaColor: settings.fill,
                borderWidth: settings.width + 1.4,
                borderColor: settings.border,
              },
            },
            data: [],
          },
        ],
      },
      { notMerge: true },
    );
    element.setAttribute(
      'aria-label',
      region.name + (settings.variant === 'districts' ? '行政区地图' : '轮廓地图'),
    );
    layoutLabels();
  }

  chart.on('click', (params) => onSelect(params.name));
  chart.on('georoam', () => {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(layoutLabels);
  });
  const observer = new ResizeObserver(() => {
    chart.resize();
    layoutLabels();
    onResize();
  });
  observer.observe(element);

  return {
    show({ region, key, geoJSON, settings }) {
      if (!regions.has(key)) {
        echarts.registerMap(key, geoJSON);
        const parsed = echarts.parseGeoJSON(geoJSON);
        parsed.sort((a, b) => {
          const ar = a.getBoundingRect();
          const br = b.getBoundingRect();
          return br.width * br.height - ar.width * ar.height;
        });
        regions.set(key, parsed);
      }
      render({ region, key, settings }, true);
    },
    update(settings) {
      if (model) render({ ...model, settings });
    },
    reset() {
      if (model) render(model, true);
    },
    zoom(factor) {
      if (!model) return;
      const zoom = Math.max(0.5, Math.min(12, chart.getOption().series[0].zoom * factor));
      chart.setOption({ series: [{ id: 'region', zoom }] });
      layoutLabels();
    },
    dimensions(scale) {
      return {
        width: Math.round(chart.getWidth() * scale),
        height: Math.round(chart.getHeight() * scale),
      };
    },
    capturePng({ scale, transparent, background }) {
      if (!model) throw new Error('请先选择地图');
      const { width, height } = this.dimensions(scale);
      if (width * height > 64 * 1024 * 1024) throw new Error('图片尺寸过大，请降低导出精度');
      const canvas = document.createElement('div');
      canvas.style.cssText = 'position:fixed;left:-20000px;top:0';
      canvas.style.width = chart.getWidth() + 'px';
      canvas.style.height = chart.getHeight() + 'px';
      document.body.append(canvas);
      let exportChart;
      try {
        exportChart = echarts.init(canvas, null, { renderer: 'canvas', devicePixelRatio: 1 });
        const option = chart.getOption();
        option.tooltip = { show: false };
        for (const series of option.series) {
          series.selectedMap = {};
          series.selectedMode = false;
          series.silent = true;
        }
        exportChart.setOption(option);
        return exportChart.getDataURL({
          type: 'png',
          pixelRatio: scale,
          backgroundColor: transparent ? 'rgba(0,0,0,0)' : background,
        });
      } finally {
        exportChart?.dispose();
        canvas.remove();
      }
    },
    dispose() {
      observer.disconnect();
      cancelAnimationFrame(layoutFrame);
      chart.dispose();
    },
  };
}
