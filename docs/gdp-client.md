# GDP 客户端接入

GDP是现有地图的可选专题，年度列表来自离线资源。当前启用2025年；不跨年补数，不用上级地区总量代替下级缺失值。

## 数据流与边界

1. `scripts/prepare-gdp.py` 从已归档原件和复核记录生成年度快照。
2. `scripts/prepare-gdp-resources.cjs` 核对来源文件SHA-256、快照与清单、地图目录和年度口径，按字段白名单生成 `resources/gdp/`。启用年度与范围例外集中在 `data/gdp/map-scope.json`。所有年度验证成功后才写资源，索引最后写入。
3. `electron/gdp-repository.cjs` 按需读取资源，验证索引、资源校验和与记录结构。成功读取缓存，失败清除缓存以允许重试。GDP资源损坏不阻止普通地图启动。
4. `renderer/gdp-store.mjs` 管理年度加载状态、缓存和过期响应；`gdp-model.mjs` 是不依赖DOM、IPC或ECharts的纯转换，按地图目录的父子ID关系对应分区。
5. `gdp-panel.mjs` 显示年度、覆盖与来源；`map-view.mjs` 负责ECharts，使用 `gdp-graphics.mjs` 生成屏幕和PNG共享的图例。地图名称布局为图例预留空间。`app.js` 协调选择、设置与上述模块。

没有引入通用指标框架或额外数据库。数据规模适合每年一份JSON，后续更新沿用相同校验流程。

## 桌面API

渲染进程使用 `createAtlasClient(window.atlas)`；桥接保持现有的成功/错误信封协议。IPC先检查所属窗口及主页面URL。

| 方法                | 输入                                | 返回                                                                       |
| ------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `listGdpDatasets()` | 无                                  | 年度元数据数组：year、unit、currency、priceBasis、retrievedOn、recordCount |
| `getGdp({ year })`  | 1900–2100的整数年份，仅接受year字段 | 一份完整年度数据，schemaVersion为1                                         |

年度数据包含 `records` 与 `exclusions`。记录包含regionId、regionName、value、status、source及可选scopeNote；source仅含publisher、title、url、publishedOn。金额是现价人民币亿元。日期为YYYY-MM-DD；publishedOn可空。status为preliminary、final或as-published。范围限制包含regionId和reason。原件文件名与提取细节不进入IPC。

不可用年份或非法请求返回 `GDP_YEAR_NOT_FOUND`；目录、校验和或内容错误返回 `GDP_UNAVAILABLE`。客户端恢复为可重试的错误状态，保留地图浏览，暂停GDP图片导出。设置保存的年份不再可用时选择最新可用年份，界面明确显示实际年份。

## 地图语义

- 全国图按省级记录，省图按市级记录，直辖市图按区县记录对应；同名地区不跨父级匹配。
- 有值、缺失、范围待核实是三个独立状态。范围限制优先于已有数值。缺失与限制地区均用中性色，悬停与资料区说明具体状态。
- 纯轮廓与叶子地图显示当前地区总量。普通城市有总量但缺下辖区县数据时，分区保持中性色，画布标注城市总量和下辖地区缺失情况。
- 全国省级分区使用固定阈值10000、30000、60000、100000；市与区县分区使用500、1000、3000、10000，单位均为亿元。不同地图间不按当前样本重新缩放。五级颜色由现有填充色生成，边界与文字仍独立设置。
- PNG包含实际年度、单位、价格口径、图例、缺失数量及核算状态；文件名包含年度与GDP。屏幕和导出使用同一模型，不额外计算数值。

## 验证

`npm test` 覆盖精确匹配、范围限制、资源校验、失败重试、并发过期响应、IPC与设置。Python GDP测试复核快照导入。`npm run smoke` 在真实Electron中检查全部地图、GDP覆盖、三套配色、窄窗口、PNG与重启恢复，同时监测控制台和网络请求。
