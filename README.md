简体中文 | [English](README.en.md)

# dsh-side-panel-patched

DSH Web 右侧工作区面板（文件浏览器 / Git 审查 / 终端）的本地增强版（fork 维护）。

- **上游**：[ccq1/dsh-side-panel](https://github.com/ccq1/dsh-side-panel)（BSD-3-Clause，v0.2.0，安装源 `github:ccq1/dsh-side-panel`）—— 右侧面板 = 文件树/预览/编辑（CodeMirror）+ Git 审查 + 终端（xterm）；Node 端提供 `/side-panel/api`（文件/Git/终端 API）
- **本目录** = 上游代码 + 本地增强（改动带 `PATCH(2026-08-14)` / `PATCH(2026-08-21)` 标记，`grep` 可定位；详见 git log）

## 功能增强（相对上游 v0.2.0）

原理与实现细节见源码内 `PATCH(2026-08-14)` 标记与 CHANGELOG.md / git log，此处仅列要点：独立面板挂载（不依赖官方 details 列、绕开 520px 宽度上限、`position:fixed` 右侧 420px ~ 60% 视口可拖拽、宽度持久化）；44px 标题 + 28px tabs 头部像素级对齐官方；Codex 风格梭形拖拽把手；Windows 终端防护（友好错误不 spawn、spawn 挂 error 处理、单命令改用 `cmd.exe /c`）；`ctx.sessions` / `ctx.workspaces` 服务注入声明补齐（会话切换跟踪、文件 tab 按会话分组）；放大按钮在 60% 视口与全宽间切换且拖拽值不丢；多文件 tab 栈（树单例跟随激活 tab、滚动位置跨 tab 保持、首文件打开后自动隐藏「文件」功能 tab、tab 按会话/工作区分组互不串扰）。

### 2026-08-21：markdown 预览增强（`PATCH(2026-08-21)`）

- GitHub 风格排版（亮/暗主题自适应）+ 代码围栏 lezer 语法高亮（复用插件内置的 CodeMirror 解析器，零新依赖）+ 语言徽标
- ` ```mermaid ` 围栏按需渲染为 SVG：引擎从 CDN 懒加载（jsdelivr → unpkg，`mermaid@11.17.0`），主题跟随 DSH 并在切换时重渲染，输出再过 DOMPurify；离线 / CSP 拦截 / 语法错误时降级为源码视图
- 实现入口：`lib/client.js` 中 `dfbRenderMarkdown` / `markdownCss` / `dfbRenderMermaidBlocks`；`src/` 为源码（`npm run build` 由 `src/host` + `src/client` 构建 `lib/`）

## 安装

```bash
# 从 GitHub 安装（推荐）
dsh plugin --profile web add github:DDDFXYqiming/dsh-side-panel-patched
# 本地开发时也可直接使用仓库目录
dsh plugin --profile web add <本目录>
```

## 发布形态

- 本包以预构建产物分发（插件实际加载 `lib/`）；`src/` + `tsconfig.json` 为唯一源码，`npm run build` = host + client → `lib/`——`prepare` 脚本仅做产物存在性自检，`npm pack` / GitHub 安装均可通过（publish.md 兼容路径）
- scoped 包已配置 `publishConfig.access: public`；所有前端依赖（codemirror / xterm 等）已内联进 bundle，声明于 `devDependencies`（构建期使用）
- 配置默认值由插件内 Schemastery `Config` 提供（`maxTextBytes` / `maxImageBytes` / `searchMaxResults`），`cordis.patch.yml` 不再携带默认值
- `/side-panel/api` 已加 Host/Origin 回环校验（仅接受 `127.0.0.1` / `localhost` / `[::1]` 来源）

## 已知边界

- 终端功能 Windows 不可用（Unix PTY 限制，需改用 ConPTY / node-pty）
- 面板覆盖官方 detailsCol（官方「工具调用详情」面板被遮挡）
- 浏览器端插件：改动 `lib/client.js` 后需强刷生效；Node 端 `lib/index.js` 改动需重启宿主
- `findFrameParts` 用 `[data-details-collapsed]` / `[class*="centerCol"]` 定位官方布局（hash class 后缀稳定），DSH 大版本升级若改结构需重新适配

## License

MIT（详见 LICENSE；上游 [ccq1/dsh-side-panel](https://github.com/ccq1/dsh-side-panel) 原为 BSD-3-Clause，已在 LICENSE 中保留其归属）
