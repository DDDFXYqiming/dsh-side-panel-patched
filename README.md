简体中文 | [English](README.en.md)

# dsh-side-panel-patched

DSH Web 右侧工作区面板（文件浏览器 / Git 审查 / 终端）的本地增强版，以 fork 形式维护。

- 上游是 [ccq1/dsh-side-panel](https://github.com/ccq1/dsh-side-panel)（BSD-3-Clause，v0.2.0，安装源 `github:ccq1/dsh-side-panel`）。它提供右侧面板的基础功能，包括文件树、预览、编辑（CodeMirror）、Git 审查与终端（xterm），Node 端暴露 `/side-panel/api`（文件 / Git / 终端 API）
- 本仓库在上游代码上叠加本地增强。改动在源码里带 `PATCH(2026-08-14)`、`PATCH(2026-08-21)`、`PATCH(2026-08-27)` 标记，`grep` 能直接定位，完整过程翻 git log 就能看到

## 功能增强（相对上游 v0.2.0）

实现细节都写在源码的 `PATCH` 标记旁边，git log 里有完整过程，这里只列要点。

- **独立面板挂载**。面板放进自己的挂载点，绕开了官方 details 列和 520px 宽度上限。它用 `position:fixed` 停在右侧，宽度能在 420px ~ 60% 视口之间拖拽，拖出来的宽度会持久保存
- **头部尺寸与官方界面一致**。标题栏 44px，tabs 栏 28px，像素级贴合
- **Codex 风格梭形拖拽把手**
- **Windows 原生终端**。v0.2.1 使用可选依赖 `node-pty` 的 ConPTY 支持交互输入、输出和实时调整尺寸；单命令模式走隐藏窗口的 `cmd.exe /c`。Linux 保留 `script` PTY，运行期尺寸调整仍返回 `applied:false`。
- **`ctx.sessions` / `ctx.workspaces` 服务注入声明补齐**。会话切换能被跟踪，文件 tab 按会话分组
- **终端会话归属**（`PATCH(2026-08-27)`）。宿主按 `owner=sessionId` 校验所有 `terminal-*` 动作，轮询、输入、缩放、关闭都绑定打开终端时的那个会话
- **放大按钮**在 60% 视口与全宽之间切换，拖拽出的宽度保留
- **多文件 tab 栈**。文件树是单例，跟随当前激活的 tab；滚动位置跨 tab 保持；打开第一个文件后自动隐藏「文件」功能 tab；tab 按会话与工作区分组，互不串扰

### markdown 预览增强（2026-08-21，`PATCH(2026-08-21)`）

- GitHub 风格排版，亮暗主题自适应。代码围栏用 lezer 做语法高亮，解析器复用插件内置的 CodeMirror，没有新增依赖，每段代码带语言徽标
- `mermaid` 代码围栏按需渲染成 SVG。渲染引擎从 CDN 懒加载（先 jsdelivr 后 unpkg，`mermaid@11.17.0`），主题跟随 DSH，切换时重新渲染，输出再过一遍 DOMPurify。离线、CSP 拦截或语法出错时降级回源码视图
- 实现入口在 `lib/client.js` 的 `dfbRenderMarkdown` / `markdownCss` / `dfbRenderMermaidBlocks`。`src/` 是源码，`npm run build` 由 `src/host` 与 `src/client` 构建出 `lib/`

## 安装

v0.2.1 已针对 DSH `0.1.2-rc.1` 验证。Windows 需要支持 ConPTY 的系统（Windows 10 1809+）及 `node-pty` 原生组件；Linux 使用 `script`、`stty` 和 Bash。`pnpm test` 同时覆盖终端实际命令输出、归属校验和目录链接边界。

```bash
# 从 GitHub 安装（推荐）
dsh plugin --profile web add github:DDDFXYqiming/dsh-side-panel-patched
# 本地开发时也可直接使用仓库目录
dsh plugin --profile web add <本目录>
```

## 发布形态

- 插件实际加载 `lib/`，本包以预构建产物分发。`src/` 与 `tsconfig.json` 是唯一的源码，`npm run build` 把 host 和 client 一起构建进 `lib/`（host 侧经 typescript 转译擦类型）。`prepare` 脚本运行完整 `build + check`，`npm pack` 和 GitHub 安装都会重新产出 `lib/`；pnpm ≥10 首次 git 安装需在 profile 的 `pnpm-workspace.yaml` 放行：`allowBuilds:` 下加入 pnpm 打印的本包键
- scoped 包已配置 `publishConfig.access: public`。所有前端依赖（codemirror / xterm 等）都内联进 bundle，声明在 `devDependencies` 里，只在构建期使用
- 配置默认值由插件内的 Schemastery `Config` 提供（`maxTextBytes` / `maxImageBytes` / `searchMaxResults` / `terminalTimeoutMs` / `searchNodeBudget`），`cordis.patch.yml` 不再携带默认值
- `/side-panel/api` 加了 Host / Origin 回环校验，只接受 `127.0.0.1` / `localhost` / `[::1]` 来源

## 已知边界

- Windows 交互终端需要 `node-pty` 的 ConPTY 原生组件；Linux `script` 后端只在启动时设置尺寸。
- 面板覆盖官方 detailsCol，官方「工具调用详情」面板会被挡住
- 这是浏览器端插件。改了 `lib/client.js` 需要强刷页面生效；Node 端 `lib/index.js` 的改动需要重启宿主
- `findFrameParts` 用 `[data-details-collapsed]` / `[class*="centerCol"]` 定位官方布局，hash class 后缀是稳定的。DSH 大版本升级如果改了结构，这里要重新适配

## License

MIT（见 LICENSE 文件）。上游 [ccq1/dsh-side-panel](https://github.com/ccq1/dsh-side-panel) 原为 BSD-3-Clause，其归属已在 LICENSE 中保留
