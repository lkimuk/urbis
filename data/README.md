# 离线行政区地图

客户端主库已切换到用户于 2026-10-30 从[天地图行政区划页面](https://cloudcenter.tianditu.gov.cn/administrativeDivision)下载的三份 GeoJSON。原始字节保存在 `tianditu/`，逐文件 SHA-256、原文件名、下载入口和页面说明见 `tianditu/manifest.json`。启动、构建及安装包运行均不下载地图。

## 当前主库

原文件有 34 个省级面、375 个市级文件面、2,890 个县级文件面。跨层相同代码的整体代理不增加重复导航，生成全国 1、省级 34、城市层 368、区县层 2,890，共 3,293 个主库条目。这些是地图记录及应用层级数量，不代表现行行政单位总数。

`scripts/tianditu-catalog.cjs` 校验原件哈希，按 gb 前缀及相同代码代理生成父子关系；来源属性及面坐标保持原样，不简化、不量化、不自动修复。各级纯轮廓由该地图实际显示分区的并集生成，避免旧版两种模式范围不一致。

境界线不参与行政区目录，以 GeoJSON 扩展字段 `boundaryLines` 存储，在 ECharts 中使用共享 geo 坐标系的独立线图层。全国保留全部省级来源线；下级图使用其分区来源层的线，裁剪到地图包络，裁剪不赋予线任何额外行政含义。

全国 ID 为 `100000`，省级为六位来源代码后缀；城市 ID 为 `tdt-` 加六位后缀，区县为 `tdt-county-` 加六位后缀。原始九位 gb 保留在 `sourceId`，不将其宣称为经过权威名录验证的现行行政代码。直辖市、港澳及台湾跳过整体市级代理，直接进入县级文件中的分区。

旧城市及区县 ID 在名称、父级均明确匹配时加入 `aliases`，启动时迁移偏好并保留标题及样式。无法明确匹配的旧城市回到全国，详见生成的 `resources/tianditu-links-report.json`。精确存在的条目 ID 优先于别名。

## 历史补充

新来源没有台湾市县以下的区乡镇，也没有澳门堂区明细。因此保留原图库台湾及澳门的 23 个城市条目与 376 个区县条目，合计 399 个，单独列为历史补充。它们不参与主库父级地图拼接，界面显示独立来源与坐标声明。主库与补充合计 3,692 个条目、7,384 个模式、7,008 个独立地图文件。

旧城市数据仍在仓库根 `js/`；`scripts/region-catalog.cjs` 与 `county-catalog.cjs` 为旧 ID 映射及补充构建历史目录，资源准备完成后删除不再被当前目录引用的生成地图。`regions/` 中原 ECharts 4.8.0 快照保留作为历史输入，主库不再使用其几何。其导入工具 `scripts/import-regions.cjs` 及完整性测试继续保留。旧库缺陷记录见 [历史审计](AUDIT.md)。

## 坐标与使用说明

天地图原件声明 CGCS2000（EPSG:4490），本次未转换坐标基准。页面标注“2026 年 10 月，局部数据更新”，不能据此认定所有区域有统一基准日。台湾覆盖、金门归组、澳门覆盖及核验方法见 [天地图核验](TIANDITU-AUDIT.md)。不增加乡镇／街道地图。

页面说明“本数据仅供地图可视化使用”。项目 MIT 仅适用于相应代码，不能作为天地图数据的授权；本地接入及公开来源本身不证明离线再分发或商业用途授权。对外分发须遵守数据来源条款。此说明随包复制到 `TIANDITU-NOTICE.txt`。历史补充的原条款复制到 `CITY-MAPS-SOURCE-NOTICE.txt`，保留原许可证说明。

## 更新与核验

更新时，从官方入口下载完整的省、市、县文件，先运行只读 GIS 审计，再分别按原始字节保存为 `provinces.geojson`、`cities.geojson`、`counties.geojson`，更新 manifest 的哈希及来源日期。不要将旧 manifest 哈希用于新文件，也不要把下载日期当作全部区划日期。

```powershell
# 在 desktop 目录执行；Shapely 2.x 仅为维护依赖
python scripts/audit-tianditu.py data/tianditu --output artifacts/tianditu-verification.json
npm run audit:maps
python scripts/audit-generated.py resources --output artifacts/tianditu-generated.json
npm test
npm run smoke
```

第一项检查全部原几何、哈希、编码归组及父子范围；第二项检查生成文件、原面无损、轮廓并集、层级、别名、ECharts 解析及境界线；第三项用独立 Shapely 实现复查生成主库几何有效性及两种模式范围。检查不能证明标准制图表达、现行区划或授权状态。原件不经过自动几何修复。
