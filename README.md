# dsh-side-panel-patched

DSH Web 右侧工作区面板（文件浏览器 / Git 审查 / 终端）的本地增强版（fork 维护）。

## 来源

- 上游项目：[ccq1/dsh-side-panel](https://github.com/ccq1/dsh-side-panel)（BSD-3-Clause，v0.2.0，安装源 `github:ccq1/dsh-side-panel`）
- 上游能力：右侧面板 = 文件树/预览/编辑（CodeMirror）+ Git 审查 + 终端（xterm）；Node 端提供 `/side-panel/api`（文件/Git/终端 API）
- 本目录为上游代码 + 2026-08-14 本地增强（所有改动带 `PATCH(2026-08-14)` 标记，可 grep 定位）

## 增强内容（相对上游 v0.2.0）

### 1. 面板挂载：绕开官方 details 列 520px 宽度上限（v4）

上游把面板挂进 DSH 官方三栏 grid（sidebar | conversation | details）的 detailsCol —— 但官方列宽被 `clampWidth(px, 300, 520)` 硬限制在 520px（`dsh-client-ui-layout` 源码限制，插件无法突破）。

本版改为**不依赖官方 details 列**（零官方源码修改）：
- 面板 `position:fixed` 视口右侧，宽度自由（**420 ~ 60% 视口**）
- 官方 center 列运行时 `padding-right = 面板宽度` → 聊天区挤压（等效真右侧栏）
- 拖拽用插件自带 resizer；宽度持久化 `localStorage["dsh.file-browser.width"]`（默认 600）

### 2. 头部结构与官方 header 像素级对齐

官方 header 是"44px 标题行 + 28px tabs 行"（分割线在 y=75），面板头部镜像：
- 行1 `dfb-head` 44px（padding-top 12px，对齐官方标题行）
- 行2 `dfb-file-toolbar` 30px（padding-top 4px，对齐官方 tabs 行）
- 分割线（toolbar border-bottom）在 y=74，与官方 header:after 线（bottom:1px + 高1px → 实际 y=74）**相邻连续**
- 分割线颜色用官方同款 `--dsw-alias-border-l2` + 微阴影

### 3. 拖拽把手梭形动效（Codex 风格）

hover/拖动时显示纯线性梭形（菱形 `clip-path: polygon(50% 0,0% 50%,50% 100%,100% 50%)`，两端归零），
浅灰 `rgba(128,128,128,.3)`，0.15s 淡入过渡。

### 4. Windows 终端防护（防宿主崩溃）

上游终端是纯 Unix 实现（`spawn("script", ...)` + 硬编码 `/bin/bash`），Windows 上 ENOENT 且无 error 处理 → **未捕获错误直接击穿宿主进程**（实测崩溃）。本版：
- `terminal-open` 在 Windows 上返回友好错误（不 spawn）—— 前端显示"终端功能暂不支持 Windows（PTY 依赖 Unix script 命令）"
- 所有 spawn 挂 `error` 处理器（防任何平台问题崩溃）
- 单命令模式 Windows 改用 `cmd.exe /c`

### 5. 服务注入修正

`exports.inject` 补上 `layout` 服务声明（原版缺失导致 `ctx.layout` 访问报 "cannot get property layout without inject"）。

### 6. 放大按钮全宽切换（v5）

`⛶` 展开 = 面板宽度到 **60% 视口**（记住展开前宽度）；再点恢复展开前宽度（拖拽值不丢失）；展开状态不持久化。

### 7. 多文件 tab 栈（v6，Codex 式）

- 文件树点文件 → **独立 tab**（可同时打开多个文件，tab 切换/单独关闭/同路径查重激活）
- **树单例跟随**激活的文件 tab（左预览 + 右树）；树滚动位置跨 tab 保持（强制 reflow + rAF 双保险）
- 打开第一个文件后**自动隐藏「文件」功能 tab**（冗余入口）；关闭全部后恢复
- 文件 tab 视图去掉冗余路径条（tab 标签即文件名）
- **会话（工作区）跟踪**：切换工作区 → 树重载当前工作区；文件 tab **按会话分组**（v6h）—— 只显示当前工作区的 tab，各自保留、切换互不串扰；会话切换不产生白屏、不复活「文件」功能 tab

## 安装

从 GitHub 安装（推荐）：

```bash
dsh plugin --profile web add github:DDDFXYqiming/dsh-side-panel-patched
# 本地开发时也可直接使用仓库目录
dsh plugin --profile web add <本目录>
```

## 发布形态（2026-08-14 起）

- 本包**只分发预构建产物**（`lib/` 是构建输出，仓库无 `src/`/`tsconfig.json`）——`prepare` 脚本仅做产物存在性自检，`npm pack` / GitHub 安装均可通过（publish.md 兼容路径）
- scoped 包已配置 `publishConfig.access: public`；所有前端依赖（codemirror/xterm 等）已内联进 bundle，声明于 `devDependencies`（构建期使用）
- 配置默认值由插件内 Schemastery `Config` 提供（`maxTextBytes` / `maxImageBytes` / `searchMaxResults`），`cordis.patch.yml` 不再携带默认值
- `/side-panel/api` 已加 Host/Origin 回环校验（仅接受 `127.0.0.1` / `localhost` / `[::1]` 来源）

## 已知边界

- 终端功能 Windows 不可用（Unix PTY 限制，需作者改用 ConPTY/node-pty）
- 面板覆盖官方 detailsCol（官方"工具调用详情"面板被遮挡）
- 浏览器端插件：改动 `lib/client.js` 后需强刷生效；Node 端 `lib/index.js` 改动需重启宿主
- `findFrameParts` 用 `[data-details-collapsed]` / `[class*="centerCol"]` 定位官方布局（hash class 后缀稳定），DSH 大版本升级若改结构需重新适配

## License

BSD-3-Clause（保留上游版权声明，见 LICENSE）
