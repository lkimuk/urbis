# 城市图志 · Electron 客户端

离线地图工作台。仅使用天地图数据，包含全国、34 个省级、368 个城市层及 2,890 个区县层地图，共 3,293 个条目、6,586 个地图模式及文件。支持全国 → 省 → 市 → 区县点击导航和面包屑返回，中文、拼音、拼音首字母搜索，层级与地区筛选、行政区地图与纯轮廓切换、拖动缩放、名称与标题设置、三套配色、自定义颜色及线宽、1–4 倍 PNG 导出和透明背景。地图和样式偏好会保存在本机。

首次使用默认打开全国地图，后续恢复上次选择。支持全国 → 省 → 市 → 区县，区县可单独查看外轮廓和导出，不含乡镇／街道分区。直辖市及港澳可从省级图直接进入区县。纯轮廓模式不进入下级，各层级共用同一渲染和导出模块。

## 开发与运行

需要 Node.js 22.12 或更新版本，以及 Windows 10/11。首次安装依赖需要联网，运行和查看地图无需联网。

```powershell
cd desktop
npm ci
npm start
```

`Ctrl+K` 搜索城市；`Ctrl+S` 导出图片。导出会打开系统文件保存窗口。图片包含当前标题、样式和地图视野，不包含应用界面、悬浮提示和选中高亮。

## Windows 打包

```powershell
# 生成可直接运行的应用目录
npm run pack

# 生成可选安装目录、带桌面快捷方式的安装包
npm run dist
```

输出在 `desktop/release/`。应用目录中的 `CityAtlas.exe` 依赖同目录文件；安装包文件名为 `CityAtlas-Setup-0.1.0.exe`。当前版本未配置代码签名。数据使用及对外分发须遵守来源条款，见 [数据说明](data/README.md)。

若本机已在 `build-tools/nsis-bundle/` 准备并校验 NSIS 工具，可在 PowerShell 中设置 `ELECTRON_BUILDER_NSIS_DIR` 和 `ELECTRON_BUILDER_NSIS_RESOURCES_DIR` 为该目录的绝对路径，再执行 `npm run dist`，避免重复下载打包工具。

## 验证

```powershell
npm run smoke
npm run audit:maps
```

在独立的临时 Electron 配置目录中，通过页面控件和公开 API 检查 3,293 个条目、6,586 个地图模式、全国到省市区县的真实鼠标点击与面包屑返回、直辖市及港澳台湾、境界线及 PNG 导出、零网络请求、搜索筛选、两种模式、IPC 错误码、PNG 透明通道、样式重置和旧 ID 迁移后的偏好恢复。启动脚本在进程退出后清理测试目录；测试不修改日常偏好，不弹出保存窗口。截图、导出图片和报告写入 `desktop/artifacts/`。

`npm test` 运行 Node 内置测试框架的业务和服务回归测试；`npm run format:check` 检查源码格式；`npm run format` 统一格式。

## 资源与结构

主库原件检查与覆盖限制详见 [天地图核验](data/TIANDITU-AUDIT.md)，旧库问题见 [历史地图数据审计](data/AUDIT.md)。audit:maps 验证结构及无损转换，不能证明地理内容准确或区划为现行版本。

- `electron/main.cjs`：应用生命周期、窗口、安全配置和服务装配。
- `electron/map-repository.cjs`：索引及地图文件读取，隐藏文件路径。
- `electron/image-export.cjs`：PNG 校验、尺寸限制、文件名清理和保存；保存路径由主进程提供。
- `electron/ipc.cjs` / `preload.cjs`：调用方验证和隔离桥接，使用普通数据结果跨进程传递错误。
- `renderer/app.js`：控件事件、加载状态和页面协调，不直接调用 ECharts。
- `renderer/map-view.mjs`：地图渲染、视野、标签避让和独立画布导出，不依赖控件 ID 或 IPC。
- `renderer/settings.mjs` / `catalog.mjs`：设置校验与存储、城市筛选、请求去重和过期请求处理，可在 Node 中独立测试。
- `renderer/desktop-api.mjs`：页面 API 适配器，将桥接结果恢复为 Promise 返回值或带错误码的异常。
- `scripts/tianditu-catalog.cjs`：校验天地图固定快照，生成统一主库、轮廓并集、境界线、父子关系和旧 ID 别名。polygon-clipping 与 pinyin-pro 仅在构建时使用。
- `scripts/prepare-assets.cjs`：生成离线地图，清除过期生成地图，复制本地 ECharts 及来源说明。所有启动、地图验证、打包命令都会先运行此脚本。
- `resources/`：自动生成的离线资源，不提交到 Git；打包后包含在应用内部。

渲染进程关闭 Node.js 集成，启用隔离与沙盒，通过白名单 IPC 获取地图、保存 PNG。禁止页面导航、新窗口和权限请求；页面不请求远程脚本、字体或服务。

页面通过 `createAtlasClient(window.atlas)` 获取三个 Promise 操作：

| 操作                               | 输入                                      | 返回                                                                                                         |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `getRegions()`                     | 无                                        | 行政区描述数组（含 id、level、parentId、children、名称、搜索字段、分区名称、source、crs、sourceId、aliases） |
| `getMap({ regionId, variant })`    | variant 为 `districts` 或 `outline`       | GeoJSON，含 boundaryLines 经纬度折线数组                                                                     |
| `saveImage({ dataURL, filename })` | PNG data URL 和建议文件名，不接受文件路径 | `{ canceled: true }` 或 `{ canceled: false, filePath, size }`                                                |

失败时抛出含 `code`、`message` 的异常。错误码包括 `MAP_NOT_FOUND`、`MAP_UNAVAILABLE`、`INVALID_IMAGE`、`IMAGE_TOO_LARGE`、`EXPORT_BUSY`、`SAVE_FAILED`、`UNTRUSTED_CALLER` 和 `INTERNAL_ERROR`。桥接层传输 `{ ok, value/error }` 普通数据；错误对象在页面中创建，避免 Electron 丢失自定义错误属性。

地图数据仅按需加载，同一请求复用进行中的 Promise，失败可重试，过期结果不覆盖新选择。标题随当前城市一起保存；“重置”恢复外观，保留地图模式、导出选项及视野。应用使用单实例窗口；地图视图在页面卸载时释放观察器和 ECharts 实例。

主库使用 data/tianditu/ 中固定的原始快照，每次资源生成校验 SHA-256，保持 EPSG:4490 坐标声明；两种模式共享同源分区及境界线。旧 ID 迁移仅依赖 data/legacy-aliases.json 名称映射，不构建或打包旧地图。MIT 适用于相应代码，不代表地图数据授权。程序中的分区数量代表地图要素数量，页面更新时间不代表统一行政区划基准日。详见 [数据来源与维护说明](data/README.md)。
