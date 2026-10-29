# 城市图志 · Electron 客户端

离线城市地图工作台。内置本仓库的 392 个城市及行政区条目，支持中文、拼音、拼音首字母搜索，地区筛选、区县地图与纯轮廓切换、拖动缩放、名称与标题设置、三套配色、自定义颜色及线宽、1–4 倍 PNG 导出和透明背景。城市和样式偏好会保存在本机。

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

输出在 `desktop/release/`。应用目录中的 `CityAtlas.exe` 必须与其他文件一起分发；安装包 `CityAtlas-Setup-0.1.0.exe` 可以单独分发。当前版本未配置代码签名。

若本机已在 `build-tools/nsis-bundle/` 准备并校验 NSIS 工具，可在 PowerShell 中设置 `ELECTRON_BUILDER_NSIS_DIR` 和 `ELECTRON_BUILDER_NSIS_RESOURCES_DIR` 为该目录的绝对路径，再执行 `npm run dist`，避免重复下载打包工具。

## 验证

```powershell
npm run smoke
```

在独立的临时 Electron 会话中检查 392 个条目、784 份地图的读取和解码、搜索和筛选、两种模式、连续切换、IPC 参数校验以及 PNG 透明通道。截图、导出图片和检查报告写入 `desktop/artifacts/`，不会修改日常使用的偏好。验证模式不弹出保存窗口。

## 资源与结构

- `electron/`：窗口、隔离桥接、受限地图读取接口、系统保存窗口。
- `renderer/`：HTML/CSS/JS 界面，使用 ECharts 6 Canvas 渲染。
- `scripts/prepare-assets.cjs`：从仓库根目录 `registry.json`、`structure.json` 和 `js/` 生成地图库，复制本地 ECharts 及许可证。所有启动、验证、打包命令都会先运行此脚本。
- `resources/`：自动生成的离线资源，不提交到 Git；打包后包含在应用内部。

渲染进程关闭 Node.js 集成，启用隔离与沙盒，通过白名单 IPC 获取地图、保存 PNG。禁止页面导航、新窗口和权限请求；页面不请求远程脚本、字体或服务。

地图沿用本仓库的历史行政区划，并非最新区划库。程序中的“区县”数量代表地图要素数量；个别地图要素包含特殊地区。可在界面“关于地图数据”查看说明。地图数据按仓库 MIT 许可证使用；Apache ECharts 按 Apache-2.0 使用，许可证随资源打包。
