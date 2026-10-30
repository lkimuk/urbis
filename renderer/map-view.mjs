import { layoutRegionLabels } from './label-layout.mjs';

let nextMapId = 0;

// This module owns ECharts and its canvas. It has no knowledge of form controls or IPC.
export function createMapView({ echarts, element, onSelect, onResize }) {
  const chart = echarts.init(element, null, {
    renderer: 'canvas',
    devicePixelRatio: window.devicePixelRatio,
  });
  // Replacing one registration per view releases ECharts' previous map resource.
  const mapName = 'urbis-view-' + ++nextMapId;
  let regions = [];
  let boundaries = [];
  let model;
  let layoutFrame;
  let labelRevision = 0;

  function layoutLabels() {
    if (!model) return;
    const { settings } = model;
    let labels = [];
    if (settings.variant === 'districts' && settings.labels) {
      const project = (point) => chart.convertToPixel({ geoIndex: 0 }, point);
      const projected = regions.map((region) => ({
        name: region.name,
        polygons: region.geometries
          .filter((geometry) => geometry.type === 'polygon')
          .map((geometry) =>
            [geometry.exterior, ...(geometry.interiors || [])].map((ring) => ring.map(project)),
          ),
      }));
      labels = layoutRegionLabels(projected, {
        width: chart.getWidth(),
        height: chart.getHeight(),
        measureText: (text) =>
          echarts.format.getTextRect(text, '12px "Microsoft YaHei", sans-serif').width,
        reserved: settings.showTitle
          ? [
              {
                left: 24,
                top: 20,
                right: Math.min(
                  chart.getWidth() - 10,
                  40 +
                    echarts.format.getTextRect(
                      settings.title.trim() || model.region.name,
                      '25px SimSun',
                    ).width,
                ),
                bottom: 62,
              },
            ]
          : [],
        lines: boundaries.map((line) => line.map(project)),
      });
    }
    const children = [];
    for (const label of labels) {
      if (label.line)
        children.push({
          type: 'polyline',
          z: 19,
          silent: true,
          shape: { points: label.line },
          style: { stroke: settings.text, lineWidth: 0.8, opacity: 0.8, fill: null },
        });
      children.push({
        type: 'text',
        z: 20,
        silent: true,
        style: {
          x: label.x,
          y: label.y,
          text: label.name,
          fill: settings.text,
          font: '12px "Microsoft YaHei", sans-serif',
          align: 'center',
          verticalAlign: 'middle',
        },
      });
    }
    chart.setOption(
      { graphic: { id: 'region-labels-' + ++labelRevision, elements: children } },
      { replaceMerge: ['graphic'] },
    );
  }

  function render({ region, settings }, reset = false) {
    const previous = reset ? null : chart.getOption()?.geo?.[0];
    model = { region, settings };
    chart.setOption(
      {
        animation: false,
        backgroundColor: settings.transparent ? 'transparent' : settings.background,
        title: {
          show: settings.showTitle,
          text: settings.title.trim() || region.name,
          left: 30,
          top: 25,
          textStyle: {
            color: settings.text,
            fontFamily: 'SimSun, serif',
            fontSize: 25,
            fontWeight: 'normal',
          },
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
        geo: {
          id: 'atlas-geo',
          map: mapName,
          roam: true,
          selectedMode: 'single',
          scaleLimit: { min: 0.5, max: 12 },
          zoom: previous?.zoom || 1,
          ...(previous?.center ? { center: previous.center } : {}),
          left: '10%',
          right: '10%',
          top: settings.showTitle ? 90 : '10%',
          bottom: '10%',
          label: {
            show: false,
            color: settings.text,
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
              show: false,
              color: settings.text,
            },
            itemStyle: { areaColor: settings.fill, shadowBlur: 8, shadowColor: '#29463833' },
          },
          select: {
            label: { show: false, color: settings.text },
            itemStyle: {
              areaColor: settings.fill,
              borderWidth: settings.width + 1.4,
              borderColor: settings.border,
            },
          },
          regions: [],
        },
        series: [
          { id: 'region', type: 'map', map: mapName, geoIndex: 0, data: [], selectedMode: false },
          {
            id: 'boundary-lines',
            type: 'lines',
            coordinateSystem: 'geo',
            geoIndex: 0,
            polyline: true,
            silent: true,
            z: 5,
            animation: false,
            lineStyle: { color: settings.border, width: settings.width, opacity: 1 },
            data: boundaries.map((coords) => ({ coords })),
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
    show({ region, geoJSON, settings }) {
      // Clear old geo models before replacing the registered geometry.
      cancelAnimationFrame(layoutFrame);
      chart.clear();
      const polygons = {
        ...geoJSON,
        features: geoJSON.features.filter((feature) =>
          ['Polygon', 'MultiPolygon'].includes(feature.geometry.type),
        ),
      };
      echarts.registerMap(mapName, polygons);
      regions = echarts.parseGeoJSON(polygons);
      boundaries = geoJSON.boundaryLines || [];
      regions.sort((a, b) => {
        const ar = a.getBoundingRect();
        const br = b.getBoundingRect();
        return br.width * br.height - ar.width * ar.height;
      });
      render({ region, settings }, true);
    },
    update(settings) {
      if (model) render({ ...model, settings });
    },
    reset() {
      if (model) render(model, true);
    },
    zoom(factor) {
      if (!model) return;
      const zoom = Math.max(0.5, Math.min(12, chart.getOption().geo[0].zoom * factor));
      chart.setOption({ geo: { zoom } });
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
      layoutLabels();
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
        option.geo.forEach((geo) => {
          geo.selectedMap = {};
          geo.selectedMode = false;
          geo.silent = true;
        });
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
      model = undefined;
      regions = [];
      boundaries = [];
      echarts.registerMap(mapName, { type: 'FeatureCollection', features: [] });
    },
  };
}
