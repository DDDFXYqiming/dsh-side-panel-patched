# DSH 侧边栏插件（@dsh-external/dsh-side-panel v0.2.0）代码评审

> 只读评审 · 评审对象：`D:\AI_Projects\dsh-side-panel-patched`
> 评审范围：src/client/index.ts（1028 行 / 94 KB）、src/protocol.ts、lib/index.js、lib/invariant.js、cordis.patch.yml、package.json、README*.md
> 评审方法：通读全部源码 + 交叉对照 lib/client.js（构建产物，关键位置抽样验证）+ 协议 d.ts

---

## 1. 一句话定位 + 总评

> **定位**：DSH Web 右侧独立挂载的多功能工作面板（Git 审查 / xterm 终端 / CodeMirror 文件工作区 / Markdown 预览含 mermaid），host 端通过 `/side-panel/api` 路由提供文件读写 + Git CLI + PTY 服务。
>
> **总评**：**7 / 10** —— 工程完整度较高，安全防御（回环校验 + path sandbox + DOMPurify + 二次解析）有层次，但存在 **src 与发布产物不完整（缺 host src）** 这一系统性维护风险，且存在 **会话切换后终端会话绑定断裂**、**GET CSRF 仅靠 Origin 头可绕过**、**README 与最新代码状态漂移** 等具体问题。

---

## 2. 架构概述

1. **双端插件形态**：host 端（`lib/index.js`，612 行 ESM）注册 cordis fiber，通过 `ctx.webServer.register` 暴露单一路由 `/side-panel/api`，所有 action 通过 `?action=...` 路由分发；client 端（`lib/client.js`，50516 行 bundle，内联 codemirror + xterm + marked + DOMPurify + mermaid 懒加载）通过 `ctx.effect` 挂载面板，监听 host `session/event` 计算 Git 边界 diff。
2. **协议单一来源**：`src/protocol.ts` 定义所有共享类型（`ApiResponse` 用判别联合保证穷尽性），host 与 client 均 re-export 这套常量与类型；host 用 child_process 执行 Git 与 PTY，client 用 fetch + JSON 走单端点。
3. **安全纵深**：路由入口校验 Host/Origin（仅本机回环）+ `inside()` 用 realpath + relative 做 path 越狱检测（处理符号链接穿透）+ Markdown 走 marked → DOMParser 二次解析 → DOMPurify sanitize 三层；mermaid SVG 单独走 `USE_PROFILES: { svg: true, svgFilters: true }`。
4. **资源生命周期**：host 在 `ctx.effect` dispose 时 SIGTERM 所有 PTY 子进程；client 在 dispose 中卸载 xterm + 三个 MutationObserver/ResizeObserver + 清理 activeEditors / fishRoots 两张 React Root Map + 卸载 DOM 节点。
5. **fork 痕迹可追溯**：所有本地增强都以 `PATCH(2026-08-XX)` / `[spec-audit 2026-08-XX]` 注释打点，可直接 grep 出本目录相对上游 v0.2.0 的所有改动。

---

## 3. 发现清单

### 🔴 严重

- **[发行形态工程风险] src/ 与 lib/ 不对称，host 端无源** — `src/` 只有 client 与 protocol；`lib/index.js` 与 `lib/invariant.js` 仅以构建产物形态存在，仓库无 `tsconfig.json` / `scripts.build`，README.md:31 明示 `src/` 是「从 sourcemap 恢复的源码参考」。结果：host 端任何 bugfix 都必须改 `lib/*.js` 并手维护；typings（`lib/types/index.d.ts:13`）刻意放宽为 `(...args: any[]) => void` 才能编译通过。一旦上游 v0.2.0 出 patch，本目录难以 rebase。
- **[CSRF 可绕过] GET 请求无 Origin 兜底** — `lib/index.js:272-275` 仅在 `origin !== ""` 时做正则校验，简单 GET（浏览器不强制带 Origin）可以 `<img>` / `<script>` / `fetch` 直接打到 `/side-panel/api?action=list&sessionId=XXX&path=...`，host 校验通过（Host = 127.0.0.1、Origin 为空放行）。属于低危只读 CSRF（仍需要猜测 / 泄露 sessionId），但与「任意文件读写 + 命令执行绝不能接受跨源调用」的代码内注释（line 266）意图相违。
- **[状态机] 终端与会话绑定断裂，session 切换后彻底失联** — `src/client/index.ts:919-921` 每次轮询都 `currentSession()` 拿当前会话，但 `terminalId`（line 894）来自最初 `ensureTerminal` 时的会话；host 端 `lib/index.js:545` 严格按 `record.owner !== sessionId` 拒读。结果：用户切会话 → 客户端每 60 ms 拉一次「terminal is unavailable」错误（`src/client/index.ts:932`），但 `terminalPoll` 永不停止。**更严重的不对称**：`xterm.onData` 回调（line 931）闭包捕获的是原会话 `sessionId`，而 `pollTerminal` 用的是新会话——读写用了不同的会话身份。`xterm.onData` 应改为始终用 `terminalId` 对应的 owner session，否则 host 端 `terminal-input` 也会被拒。

### 🟡 中等

- **[生命周期泄漏] host `turnGit` Map 永不清理** — `lib/index.js:242` 以 sessionId 为 key 累计 `lastSessionDiff`，session 销毁时无对应清理 hook；长跑宿主会持续累积（每会话多则 ~MB 级 Git diff 字符串）。
- **[文档漂移] README 与代码状态不一致** — `README.md:12` 与 `README.en.md:12` 均声称"`ctx.layout` 服务声明补齐"，但 `lib/client.js:48706` 有 `[spec-audit 2026-08-17] 移除未实际使用的 'layout' 服务注入`，实际 runtime `inject` 是 `['sessions', 'workspaces']`（`src/client/index.ts:29`），layout 已被剔除。两份 README 须同步更新。
- **[类型缺口] client 强 cast `ctx as unknown as { sessions: ... }`** — `src/client/index.ts:871-876` 因为 `lib/types/client/index.d.ts` 只声明了 `workspaces` 与 `effect` 两个 ctx 字段，缺 `sessions`，TS 编译只能强制 cast。运行时通过（cordis 按 `inject` 注入），但 cordis 注入类型应补全，否则未来 ctx 接口变化不会被类型系统捕获。
- **[API 缺配额] `write` / `terminal` 无 per-call 限额** — `lib/index.js:298-306` `write` 接受任意大小字符串（被 `requestBody` 3145728 byte 上限兜底，但单文件可被反复覆写直到磁盘满）；`lib/index.js:453-483` `terminal` 接受任意长字符串做 `cmd.exe /c` 调用，无长度/频率限制。CSRF 配合下可造成文件占位或 shell 频繁启停。
- **[shell 安全] `terminal` 注入面无白名单** — `lib/index.js:458-460` 通过 `process.env.SHELL` 解析 shell（line 500 正则兜底），`terminal-input` 走 `record.process.stdin.write`（line 560），PTY 单命令模式不区分是用户主动操作 vs CSRF 触发。建议至少对 `terminal` 加 `x-dsh-intent` 自定义头 / cookie 校验，或把单命令模式独立到「run-once」端点与持久 PTY 分开。
- **[React 反模式] 渲染路径中 `flushSync`** — `src/client/index.ts:36` 在 `createRoot(host).render` 时强制 flushSync，仅为让 whale 动画起始位置同步；在并发模式下 `flushSync` 会破坏 Suspense / Transition。仅在不可见水合场景下勉强可接受，建议注释内明示。
- **[PTY 健康度] `terminal-input` 写入死管道无 EPIPE 处理** — `lib/index.js:560` `record.process.stdin.write(body.data)` 不捕获 `EPIPE`，客户端 `terminal-close` 后服务端仍在写可能触发 unhandled exception；建议 `record.process.stdin.on('error', ...)`。
- **[Markdown] mermaid 通过 jsdelivr/unpkg CDN 加载** — `src/client/index.ts:331-332`；DSH 内嵌环境 / 严格 CSP 下不可用（README.md:18 已声明降级到源码视图），但若宿主 CSP 走 `script-src 'self'` 则连降级前的 script 注入都会失败；建议本地内联 mermaid 或在 README 增加完整 CSP 兼容说明。
- **[host 工程缺失] 无 `test/` / 无 CI / 仅有 `prepare` 文件存在性自检** — `package.json:43-46` 仅检查 lib 存在；任何回归都会逃逸到生产。1028 行 client + 612 行 host 没有任何单测覆盖。

### 🔵 建议

- **src 单文件 94 KB 拆分** — `src/client/index.ts` 内含 CSS（4 个大字符串模板合计 ~2.5 KB 行 49-150）、CSS theme（~13 行）、markdown 渲染（~120 行 211-396）、Git review 渲染（~120 行 481-601）、xterm 终端管理（~55 行 894-947）、右侧布局管理（~80 行 603-735）。建议拆 `panel/css.ts`、`panel/markdown.ts`、`panel/terminal.ts`、`panel/files.ts`、`panel/review.ts`、`panel/index.ts`。
- **`activeEditors` Map 清理逻辑可简化** — `src/client/index.ts:1013` dispose 时遍历 Map 检查 `root.contains(host)`，实际上当前实现里 `host` 只用唯一 preview 节点，应改为 `editor.view.destroy(); activeEditors.clear()` 即可。
- **search 防抖时机可改 `AbortController`** — `src/client/index.ts:706-728` 用自增 `searchRequest` 计数器去重，改成 `AbortController.abort()` 更标准；用户在慢搜索期间切会话时也能立刻丢弃。
- **`mountTab` 抢 DOM 找 Trajectory/轨迹 tab** — `src/client/index.ts:838-868` 通过遍历 `role="tablist"` 匹配 label 文本，DSH 大版本升级若 i18n 键改动即失效；建议改用稳定的 `[data-tab-id]` 钩子或直接监听 `layout` service 事件。
- **`postApi` 不带超时/重试** — `src/client/index.ts:158-161` 一次 fetch 没有 `AbortController.timeout`；终端 60 ms 轮询场景下若 host 短暂卡顿，累积的 promise 会持续 pending。
- **CSS 字符串从 TS 拆出** — 行 49-150 共四块 CSS（合计 ~5 KB）写在 TS 模板字面量里，构建工具无法 tree-shake / 压缩；建议改 `.css?raw`（Vite）或独立 `.css.ts` 配合打包注入。
- **README 增加 mermaid CSP 配置范例** — README 仅写「CSP 拦截时降级」，建议补 `connect-src` / `script-src` 推荐项，方便运维快速放行。
- **`ctx.workspaces.openPath` 调用未 catch 拒绝分支** — `src/client/index.ts:756,762` 仅 `.catch(error => console.error(...))`，失败时 UI 无任何反馈；建议把错误回灌到 contextMenu / 状态条。

---

## 4. 亮点（3-5 条）

1. **协议即真理** — `src/protocol.ts` 58 行用 TypeScript 联合判别体把全部 API 响应（list/search/preview/write/review/terminal/pty/resolve-path）固化为一个 `ApiResponse` 类型，host 写、client 读共用，编译期即保证新字段不会遗漏消费方分支。
2. **三层 XSS 防御** — Markdown 路径 `marked.parse` → `new DOMParser()` 二次解析 → `DOMPurify.sanitize`（`src/client/index.ts:286-312, 438`）；代码块的高亮 `<span class="tok-...">` 由 lezer 内部产出的白名单 class 名 + `dfbEscapeHtml`（`& < > "` 四字符）拼装，最终整段进入 DOMPurify，是真正的纵深防御而非单点。
3. **path sandbox 处理了「目标不存在」与符号链接** — `lib/index.js:28-44` 用 `realpathSync` 先 resolve 父目录、再用 `relative(realRoot, real)` 做越狱判断；目标文件不存在时 catch 内基于真实父目录拼路径仍可新建文件，且阻止了「先建软链再访问」的经典穿透。
4. **host 端崩溃自愈点全面** — Windows 上提前拦截 PTY（`lib/index.js:488-494`）、spawn 同步路径声明 `record` 提前以消除 TDZ（line 516-526）、`terminal.on('error')` 与 `terminal.stdout/stderr.on('data')` 全挂齐；Windows `terminal` 单命令改 `cmd.exe /c`；每个 host 行为修改都打 `PATCH(2026-08-14)` 注释便于追溯。
5. **生命周期 dispose 一气呵成** — `src/client/index.ts:1013` 一行清理 keydown / pointerdown / timer / ResizeObserver / MutationObserver / activeEditors / xterm / browserTab / contextMenu / addMenu / style；host 端 `ctx.effect` dispose（`lib/index.js:604-608`）同步 SIGTERM 全部 PTY 并 clear Map，符合 cordis 规范。
6. **bundle 已全量内联前端依赖** — `package.json:32-42` 的 `files` 只列 `lib/index.js` + `lib/client.js` 等产物，发布即用、安装即跑（`prepare` 仅做存在性自检，绕开对源码的依赖）。

---

## 5. Top 5 改进建议（按 ROI 排序）

| 排名 | 建议 | 影响面 | 成本 | ROI |
|------|------|--------|------|-----|
| **#1** | **修复终端会话绑定 + 增加 Origin 兜底校验**（合并 src/client/index.ts:919-932 与 lib/index.js:272-275 两处改动） | 直接消除会话切换后终端「假死」与 GET CSRF 读面 | ~30 行改动 + 一个测试用例 | **极高**（功能 + 安全双收益） |
| **#2** | **把 src/client/index.ts 拆分为 ≥ 5 个模块**（panel/{index,files,review,terminal,markdown}.ts） | 92 KB 单文件 → 每个模块 < 20 KB，可读性 + 可测试性 + 按需 lazy load | 纯重构，行为零变 | **高**（维护性长期回报） |
| **#3** | **把 src/ 与 lib/ 对齐**：补一份 host 端 `src/index.ts` 与 `tsconfig.json`，将 `lib/index.js` 标记为「构建产物而非真源」 | 解决 README 与代码漂移；让后续 patch 可在源码侧做 | 需要重建 build 工具链 | **高**（消除最大系统性风险） |
| **#4** | **添加 vitest 单测覆盖**：path sandbox（`inside`）、终端会话所有权校验、Markdown 渲染 sanitize（用 jsdom + 注入 `<script>` 负载） | 保住 host 三大安全边界不退化 | 借助 `package.json:73` 已声明的 `vitest`，新增 ~100 行 | **中高** |
| **#5** | **终端加 EPIPE + 写死管道容忍 + `terminal-input` 频率节流**（lib/index.js:560 与 565） | 杜绝「客户端 close 后服务端写挂」的 unhandled error | ~10 行 | **中**（健壮性补强） |

> **附**：本评审过程中发现的工程隐患已记录于 DSH 侧边栏插件来源（L2 记忆条目）一致的环境变量红线、Windows 终端 PTY 限制等已知边界；以上结论与既有事实不冲突，仅新增 README 漂移与会话-终端绑定断裂两条。