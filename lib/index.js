// dsh-side-panel host 端源码（v0.2.1，从 lib/index.js bundle 恢复）。
// 源文件 = src/host/index.ts；lib/index.js 由 scripts/build-host.mjs 转译（擦类型，零语义改写）生成。
// 修改请改本文件后运行 npm run build，勿直接编辑 lib/index.js。
import { realpathSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
// [spec-audit 2026-08-14] Schemastery 配置系统：加载期校验 + 默认值填充（config.md），
// 与 cordis.patch.yml 解耦——默认值单一来源（schema），用户覆盖仍走 bundle config。
import Schema from "@deepseek-ai/schemastery";
const FILE_BROWSER_ROUTE = "/side-panel/api";
// [spec-audit 2026-08-27] 状态变更 action 白名单：这些动作只允许 POST
// （依赖 body 字段 + 必须携带同源 Origin），GET 只留只读 action。
const MUTATING_ACTIONS = /* @__PURE__ */ new Set([
    "write",
    "git-stage",
    "git-unstage",
    "terminal",
    "terminal-open",
    "terminal-read",
    "terminal-input",
    "terminal-resize",
    "terminal-close"
]);
// [spec-audit 2026-08-15] 补 name 导出：官方插件形态（name + inject + apply）；
// 缺失时 loader 用 entry 包名兜底（可加载），显式声明与官方教程一致。
const name = "side-panel";
const inject = ["webServer", "sessions"];
const IMAGE_MIME = {
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp"
};
const HIDDEN = /* @__PURE__ */ new Set([".git", "node_modules"]);
const execFileAsync = promisify(execFile);
function realAncestor(dir) {
    try {
        return realpathSync(dir);
    }
    catch {
        // 目录链上有不存在的段（如新建深层目录）时逐级上溯到已存在的祖先，
        // 缺失段保持字面拼接，与目标不存在时的处理策略一致。
        return resolve(realAncestor(dirname(dir)), basename(dir));
    }
}
function inside(root, input = "") {
    const absolute = resolve(root, input || ".");
    const realRoot = realpathSync(root);
    const realParent = realAncestor(dirname(absolute));
    let real = resolve(realParent, basename(absolute));
    try {
        real = realpathSync(real);
    }
    catch {
        // 目标不存在时保持基于真实父目录的路径，仍可安全用于新建文件。
    }
    const path = relative(realRoot, real);
    if (path === ".." || path.startsWith(`..${sep}`) || resolve(path) === path)
        throw new Error("path is outside the configured workspace");
    return {
        absolute: real,
        path: path.split(sep).join("/")
    };
}
async function list(root, input) {
    const target = inside(root, input);
    const children = await readdir(target.absolute, { withFileTypes: true });
    return (await Promise.all(children.filter((child) => !child.isSymbolicLink() && !HIDDEN.has(child.name)).map(async (child) => {
        const childPath = target.path === "" ? child.name : `${target.path}/${child.name}`;
        if (child.isDirectory())
            return {
                name: child.name,
                path: childPath,
                kind: "directory"
            };
        const info = await stat(resolve(target.absolute, child.name));
        return {
            name: child.name,
            path: childPath,
            kind: "file",
            size: info.size
        };
    }))).sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1);
}
const DEFAULT_SEARCH_NODE_BUDGET = 50000;
const DEFAULT_TERMINAL_TIMEOUT_MS = 30000;
async function search(root, input, limit, nodeBudget = DEFAULT_SEARCH_NODE_BUDGET) {
    const query = input.trim().toLocaleLowerCase();
    if (query === "")
        return {
            matches: [],
            truncated: false
        };
    const matches = [];
    const pending = [""];
    let truncated = false;
    // [spec-audit 2026-08-14] 遍历节点预算：防止巨型目录树（如整个磁盘）无限遍历（Config: searchNodeBudget）
    let visited = 0;
    while (pending.length > 0) {
        if (visited >= nodeBudget) {
            truncated = true;
            pending.length = 0;
            break;
        }
        visited++;
        const directory = pending.pop() ?? "";
        let children;
        try {
            children = await readdir(resolve(root, directory), { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const child of children) {
            if (child.isSymbolicLink() || HIDDEN.has(child.name))
                continue;
            const childPath = directory === "" ? child.name : `${directory}/${child.name}`;
            if (child.isDirectory()) {
                pending.push(childPath);
                continue;
            }
            if (!child.isFile() || !childPath.toLocaleLowerCase().includes(query))
                continue;
            matches.push({
                name: child.name,
                path: childPath,
                kind: "file"
            });
            if (matches.length >= limit) {
                truncated = pending.length > 0 || children.at(-1) !== child;
                pending.length = 0;
                break;
            }
        }
    }
    matches.sort((a, b) => a.path.localeCompare(b.path));
    return {
        matches,
        truncated
    };
}
async function preview(root, input, maxText, maxImage) {
    const target = inside(root, input);
    const info = await stat(target.absolute);
    if (!info.isFile())
        throw new Error("path is not a file");
    const name = target.path.split("/").at(-1) ?? target.path;
    const extension = extname(name).toLowerCase();
    if (info.size === 0)
        return {
            kind: "empty",
            path: target.path,
            name,
            size: 0
        };
    const mime = IMAGE_MIME[extension];
    if (mime) {
        if (info.size > maxImage)
            return {
                kind: "too-large",
                path: target.path,
                name,
                size: info.size
            };
        const body = await readFile(target.absolute);
        return {
            kind: "image",
            path: target.path,
            name,
            mime,
            dataUrl: `data:${mime};base64,${body.toString("base64")}`,
            size: info.size
        };
    }
    if (info.size > maxText)
        return {
            kind: "too-large",
            path: target.path,
            name,
            size: info.size
        };
    const body = await readFile(target.absolute);
    if (body.includes(0))
        return {
            kind: "binary",
            path: target.path,
            name,
            size: info.size
        };
    return {
        kind: "text",
        path: target.path,
        name,
        extension,
        content: body.toString("utf8"),
        size: info.size
    };
}
function json(res, status, body) {
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
    });
    res.end(JSON.stringify(body));
}
async function requestBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += value.length;
        if (size > 3145728)
            throw new Error("request body is too large");
        chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function diffFiles(value) {
    const files = /* @__PURE__ */ new Map();
    for (const block of value.split(/(?=^diff --git )/m)) {
        const path = /^diff --git a\/(.*?) b\/(.*?)$/m.exec(block)?.[2];
        if (path !== void 0)
            files.set(path, block);
    }
    return files;
}
function changedDiff(before, after) {
    const previous = diffFiles(before);
    return [...diffFiles(after)].filter(([path, block]) => previous.get(path) !== block).map(([, block]) => block).join("");
}
async function workspaceDiff(root) {
    let diff = await execFileAsync("git", [
        "diff",
        "HEAD",
        "--no-ext-diff",
        "--"
    ], {
        cwd: root,
        maxBuffer: 4194304
    }).then((value) => value.stdout).catch(() => "");
    const untracked = (await execFileAsync("git", ["status", "--short"], {
        cwd: root,
        maxBuffer: 1048576
    }).then((value) => value.stdout).catch(() => "")).split("\n").filter((line) => line.startsWith("?? ")).map((line) => line.slice(3));
    for (const file of untracked)
        try {
            await execFileAsync("git", [
                "diff",
                "--no-index",
                "--",
                "/dev/null",
                file
            ], {
                cwd: root,
                maxBuffer: 2097152
            });
        }
        catch (error) {
            const output = error.stdout;
            if (typeof output === "string")
                diff += `${diff.endsWith("\n") || diff === "" ? "" : "\n"}${output}`;
        }
    return diff;
}
export const Config = Schema.object({
    maxTextBytes: Schema.number().default(2097152),
    maxImageBytes: Schema.number().default(10485760),
    searchMaxResults: Schema.number().default(200),
    terminalTimeoutMs: Schema.number().min(1000).default(DEFAULT_TERMINAL_TIMEOUT_MS),
    searchNodeBudget: Schema.number().min(1000).default(DEFAULT_SEARCH_NODE_BUDGET)
});
function apply(ctx, config = {}) {
    // 默认值唯一来源 = schema：加载期 Cordis 已填充；此处调用式校验对直调/测试的部分配置同样补齐。
    // 调用式校验：schema 填充默认值（loader 层传入的已是完整 Config；测试/直调的 Partial 在此补齐）。
    const { maxTextBytes: maxText, maxImageBytes: maxImage, searchMaxResults, terminalTimeoutMs, searchNodeBudget } = Config(config);
    const terminals = /* @__PURE__ */ new Map();
    const turnGit = /* @__PURE__ */ new Map();
    let nextTerminal = 0;
    ctx.on("session/event", ((session, event) => {
        if (event.type !== "turn/start" && event.type !== "turn/end")
            return;
        const cwd = session.header.cwd;
        if (cwd === void 0)
            return;
        const state = turnGit.get(session.id) ?? { ready: Promise.resolve() };
        state.ready = state.ready.then(async () => {
            const snapshot = await workspaceDiff(resolve(cwd));
            if (event.type === "turn/start")
                state.before = snapshot;
            else if (state.before !== void 0) {
                state.last = changedDiff(state.before, snapshot);
                state.before = void 0;
            }
        }).catch(() => { });
        turnGit.set(session.id, state);
    }));
    // [spec-audit 2026-08-29] 会话销毁时清理 turnGit，防止 Map 无界增长
    // （last 字段持有全量 diff 文本，量级可达 MB）。
    ctx.on("session/disposed", ((session) => {
        turnGit.delete(session.id);
    }));
    ctx.effect(() => {
        const disposeRoute = ctx.webServer.register({
            kind: "exact",
            path: FILE_BROWSER_ROUTE,
            handler: async (req, res) => {
                try {
                    // [spec-audit 2026-08-14] 本机服务安全：校验 Host/Origin 仅限本机回环地址。
                    // 该端点提供任意文件读写 + 命令执行，绝不能接受跨源调用（浏览器跨站请求 /
                    // 恶意页面 fetch），也不接受非本机来源的直连。
                    const host = String(req.headers.host ?? "").toLowerCase();
                    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) {
                        return json(res, 403, { ok: false, error: "forbidden host" });
                    }
                    const method = String(req.method ?? "GET").toUpperCase();
                    const origin = String(req.headers.origin ?? "").toLowerCase();
                    if (origin !== "" && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) {
                        return json(res, 403, { ok: false, error: "forbidden origin" });
                    }
                    // [spec-audit 2026-08-27] CSRF 兜底：状态变更请求必须携带同源
                    // Origin。浏览器 fetch 的同源 POST 也会带 Origin；缺失 Origin
                    // 的 POST（旧浏览器表单、脚本直发）一律拒绝。
                    if (origin === "" && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
                        return json(res, 403, { ok: false, error: "forbidden origin" });
                    }
                    const url = new URL(req.url ?? "/side-panel/api", "http://localhost");
                    const body = method === "POST" ? await requestBody(req) : {};
                    const action = typeof body.action === "string" ? body.action : url.searchParams.get("action") ?? "list";
                    // 写路径依赖 body 字段（GET 下恒缺失），显式 405 防止未来给
                    // 只读 action 误加 body 字段后留下 GET 副作用面。必须在会话
                    // 校验之前判定，否则无效 sessionId 会先 400 掩盖 405。
                    if (method !== "POST" && MUTATING_ACTIONS.has(action)) {
                        return json(res, 405, { ok: false, error: "mutating actions require POST" });
                    }
                    const sessionId = typeof body.sessionId === "string" ? body.sessionId : url.searchParams.get("sessionId");
                    if (sessionId === null || sessionId === "")
                        throw new Error("sessionId is required");
                    const cwd = ctx.sessions.get(sessionId)?.header.cwd;
                    if (cwd === void 0)
                        throw new Error("current session has no workspace");
                    const root = resolve(cwd);
                    const path = typeof body.path === "string" ? body.path : url.searchParams.get("path") ?? "";
                    if (action === "list")
                        return json(res, 200, {
                            ok: true,
                            root,
                            entries: await list(root, path)
                        });
                    if (action === "search")
                        return json(res, 200, {
                            ok: true,
                            ...await search(root, path, searchMaxResults, searchNodeBudget)
                        });
                    if (action === "preview")
                        return json(res, 200, {
                            ok: true,
                            preview: await preview(root, path, maxText, maxImage)
                        });
                    if (action === "write") {
                        if (typeof body.content !== "string")
                            throw new Error("content is required");
                        const target = inside(root, path);
                        await writeFile(target.absolute, body.content, "utf8");
                        return json(res, 200, {
                            ok: true,
                            saved: target.path
                        });
                    }
                    if (action === "review") {
                        const allowedModes = /* @__PURE__ */ new Set([
                            "unstaged",
                            "staged",
                            "commits",
                            "branches",
                            "last-session"
                        ]);
                        const mode = typeof body.mode === "string" && allowedModes.has(body.mode) ? body.mode : "unstaged";
                        const status = await execFileAsync("git", ["status", "--short"], {
                            cwd: root,
                            maxBuffer: 1048576
                        }).then((value) => value.stdout).catch(() => "当前工作区不是 Git 仓库");
                        const branch = await execFileAsync("git", [
                            "symbolic-ref",
                            "--quiet",
                            "--short",
                            "HEAD"
                        ], {
                            cwd: root,
                            maxBuffer: 65536
                        }).then((value) => value.stdout.trim()).catch(async () => execFileAsync("git", [
                            "rev-parse",
                            "--short",
                            "HEAD"
                        ], {
                            cwd: root,
                            maxBuffer: 65536
                        }).then((value) => `detached@${value.stdout.trim()}`).catch(() => ""));
                        const statusLines = status.split("\n").filter(Boolean);
                        const stagedStatus = statusLines.filter((line) => line[0] !== " " && line[0] !== "?");
                        const unstagedStatus = statusLines.filter((line) => line.startsWith("?? ") || line[1] !== " ");
                        if (mode === "last-session")
                            await turnGit.get(sessionId)?.ready;
                        const lastSessionDiff = mode === "last-session" ? turnGit.get(sessionId)?.last : void 0;
                        const relevantStatus = statusLines.filter((line) => line !== "" && (mode === "staged" ? line[0] !== " " && line[0] !== "?" : mode === "unstaged" ? line.startsWith("?? ") || line[1] !== " " : mode === "last-session" && lastSessionDiff !== void 0 ? lastSessionDiff.includes(` b/${line.slice(3).split(" -> ").at(-1) ?? line.slice(3)}`) : false)).join("\n");
                        let diff = mode === "staged" || mode === "unstaged" ? await execFileAsync("git", mode === "staged" ? [
                            "diff",
                            "--cached",
                            "--no-ext-diff",
                            "--"
                        ] : [
                            "diff",
                            "--no-ext-diff",
                            "--"
                        ], {
                            cwd: root,
                            maxBuffer: 2097152
                        }).then((value) => value.stdout).catch(() => "") : mode === "last-session" ? lastSessionDiff ?? "" : "";
                        const untracked = mode === "unstaged" ? status.split("\n").filter((line) => line.startsWith("?? ")).map((line) => line.slice(3)) : [];
                        const untrackedDiffs = await Promise.all(untracked.map(async (file) => {
                            try {
                                return (await execFileAsync("git", [
                                    "diff",
                                    "--no-index",
                                    "--",
                                    "/dev/null",
                                    file
                                ], {
                                    cwd: root,
                                    maxBuffer: 2097152
                                })).stdout;
                            }
                            catch (error) {
                                const output = error.stdout;
                                return typeof output === "string" ? output : "";
                            }
                        }));
                        if (untrackedDiffs.length > 0)
                            diff += `${diff.endsWith("\n") || diff === "" ? "" : "\n"}${untrackedDiffs.join("\n")}`;
                        const commits = mode === "commits" ? await execFileAsync("git", [
                            "log",
                            "-50",
                            "--date=relative",
                            "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%D%x1e"
                        ], {
                            cwd: root,
                            maxBuffer: 1048576
                        }).then((value) => value.stdout.split("").filter(Boolean).map((record) => {
                            const [hash = "", shortHash = "", subject = "", author = "", relativeDate = "", refs = ""] = record.replace(/^\n/, "").split("");
                            return {
                                hash,
                                shortHash,
                                subject,
                                author,
                                relativeDate,
                                refs
                            };
                        })).catch(() => []) : [];
                        const branches = mode === "branches" ? await execFileAsync("git", [
                            "for-each-ref",
                            "--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(subject)",
                            "refs/heads"
                        ], {
                            cwd: root,
                            maxBuffer: 1048576
                        }).then((value) => value.stdout.split("\n").filter(Boolean).map((line) => {
                            const [name = "", head = "", upstream = "", track = "", subject = ""] = line.split("\0");
                            const ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0);
                            const behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0);
                            return {
                                name,
                                current: head.trim() === "*",
                                upstream,
                                ahead,
                                behind,
                                subject
                            };
                        })).catch(() => []) : [];
                        const message = mode === "last-session" && lastSessionDiff === void 0 ? "暂无上轮会话快照。插件会从下一轮对话开始记录 Git 变更边界。" : void 0;
                        return json(res, 200, {
                            ok: true,
                            review: {
                                status: relevantStatus,
                                diff,
                                branch,
                                mode,
                                counts: {
                                    unstaged: unstagedStatus.length,
                                    staged: stagedStatus.length
                                },
                                commits,
                                branches,
                                ...message === void 0 ? {} : { message }
                            }
                        });
                    }
                    if (action === "git-stage" || action === "git-unstage") {
                        if (typeof body.path !== "string" || body.path === "")
                            throw new Error("path is required");
                        const target = inside(root, body.path);
                        const args = action === "git-stage" ? [
                            "add",
                            "--",
                            target.path
                        ] : [
                            "restore",
                            "--staged",
                            "--",
                            target.path
                        ];
                        await execFileAsync("git", args, {
                            cwd: root,
                            maxBuffer: 1048576
                        });
                        return json(res, 200, {
                            ok: true,
                            accepted: true
                        });
                    }
                    if (action === "terminal") {
                        if (typeof body.command !== "string" || body.command.trim() === "")
                            throw new Error("command is required");
                        try {
                            // PATCH(2026-08-14): Windows 兼容 —— /bin/bash 不存在，
                            // 改用 cmd.exe 执行单命令。
                            const [shellBin, shellArgs] = process.platform === "win32"
                                ? ["cmd.exe", ["/d", "/s", "/c", body.command]]
                                : ["/bin/bash", ["-lc", body.command]];
                            const result = await execFileAsync(shellBin, shellArgs, {
                                cwd: root,
                                timeout: terminalTimeoutMs,
                                maxBuffer: 2097152
                            });
                            return json(res, 200, {
                                ok: true,
                                terminal: {
                                    output: result.stdout + result.stderr,
                                    exitCode: 0
                                }
                            });
                        }
                        catch (error) {
                            const failure = error;
                            return json(res, 200, {
                                ok: true,
                                terminal: {
                                    output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
                                    exitCode: typeof failure.code === "number" ? failure.code : 1
                                }
                            });
                        }
                    }
                    if (action === "terminal-open") {
                        // PATCH(2026-08-14): Windows 兼容 —— script/bin/bash 是 Unix 专属，
                        // 直接 spawn 会 ENOENT 且无 error 处理导致宿主崩溃（实测）。
                        // Windows 上返回友好错误，客户端轮询自动停止。
                        if (process.platform === "win32") {
                            return json(res, 200, {
                                ok: true,
                                pty: { id: "", output: "", exited: true },
                                error: "终端功能暂不支持 Windows（PTY 依赖 Unix script 命令）"
                            });
                        }
                        const id = `side-pty-${++nextTerminal}`;
                        const requestedCols = typeof body.cols === "number" ? Math.floor(body.cols) : 80;
                        const requestedRows = typeof body.rows === "number" ? Math.floor(body.rows) : 24;
                        const cols = Math.min(500, Math.max(2, requestedCols));
                        const rows = Math.min(200, Math.max(1, requestedRows));
                        const configuredShell = process.env.SHELL || "/bin/bash";
                        const shell = /^\/[A-Za-z0-9_./-]+$/.test(configuredShell) ? configuredShell : "/bin/bash";
                        const terminal = spawn("script", [
                            "-qfec",
                            `stty cols ${cols} rows ${rows}; exec ${shell}`,
                            "/dev/null"
                        ], {
                            cwd: root,
                            env: {
                                ...process.env,
                                TERM: "xterm-256color"
                            },
                            stdio: "pipe"
                        });
                        // [spec-audit 2026-08-14] record 声明提前：消除 terminal.on("error") 闭包 TDZ
                        // （原代码在 record 声明前引用它，spawn 同步抛错路径下会 ReferenceError）
                        const record = {
                            owner: sessionId,
                            process: terminal,
                            chunks: [],
                            exited: false,
                            pendingInput: "",
                            inputTimer: void 0
                        };
                        // PATCH(2026-08-14): spawn 失败（ENOENT 等）必须处理，否则
                        // unhandled 'error' 事件直接击穿宿主进程。
                        terminal.on("error", () => {
                            record.exited = true;
                        });
                        // [spec-audit 2026-08-29] 子进程退出后写 stdin 会触发 EPIPE 'error' 事件，
                        // 未处理将击穿宿主进程，处理方式同 terminal.on("error")。
                        terminal.stdin.on("error", () => {
                            record.exited = true;
                        });
                        terminal.stdout.on("data", (chunk) => record.chunks.push(String(chunk)));
                        terminal.stderr.on("data", (chunk) => record.chunks.push(String(chunk)));
                        terminal.on("exit", () => {
                            record.exited = true;
                        });
                        terminals.set(id, record);
                        return json(res, 200, {
                            ok: true,
                            pty: {
                                id,
                                output: "",
                                exited: false
                            }
                        });
                    }
                    if (action.startsWith("terminal-")) {
                        if (typeof body.terminalId !== "string")
                            throw new Error("terminalId is required");
                        const record = terminals.get(body.terminalId);
                        if (record === void 0 || record.owner !== sessionId)
                            throw new Error("terminal is unavailable");
                        if (action === "terminal-read") {
                            const output = record.chunks.join("");
                            record.chunks.length = 0;
                            return json(res, 200, {
                                ok: true,
                                pty: {
                                    id: body.terminalId,
                                    output,
                                    exited: record.exited
                                }
                            });
                        }
                        if (action === "terminal-input") {
                            if (typeof body.data !== "string")
                                throw new Error("terminal data is required");
                            // [spec-audit 2026-08-29] 已退出的终端不再接受写入，
                            // 避免对死 pty 的写入只靠 EPIPE 兜底。
                            if (record.exited)
                                throw new Error("terminal is unavailable");
                            // [spec-audit 2026-08-29] 高频输入合并：先攒进缓冲，每 16ms（帧周期，
                            // 与 xterm.js 写入管线的时间基准一致）至多写一次 pty，避免小写入洪流。
                            record.pendingInput += body.data;
                            if (record.inputTimer === void 0) {
                                record.inputTimer = setTimeout(() => {
                                    record.inputTimer = void 0;
                                    if (!record.exited)
                                        record.process.stdin.write(record.pendingInput);
                                    record.pendingInput = "";
                                }, 16);
                            }
                            return json(res, 200, {
                                ok: true,
                                accepted: true
                            });
                        }
                        if (action === "terminal-resize") {
                            if (typeof body.cols !== "number" || typeof body.rows !== "number")
                                throw new Error("terminal dimensions are required");
                            // [spec-audit 2026-08-29] pty 尺寸只在 open 时经 stty 设置一次，
                            // 运行期无 ioctl 侧通道，诚实返回 applied:false
                            // （客户端不读取该字段，尺寸以重新 open 为准）。
                            return json(res, 200, {
                                ok: true,
                                accepted: true,
                                applied: false
                            });
                        }
                        if (action === "terminal-close") {
                            if (record.inputTimer !== void 0)
                                clearTimeout(record.inputTimer);
                            record.inputTimer = void 0;
                            record.pendingInput = "";
                            record.process.kill("SIGTERM");
                            terminals.delete(body.terminalId);
                            return json(res, 200, {
                                ok: true,
                                accepted: true
                            });
                        }
                    }
                    if (action === "resolve-path") {
                        const target = inside(root, path);
                        return json(res, 200, {
                            ok: true,
                            path: target.absolute,
                            parentPath: dirname(target.absolute),
                            platform: process.platform,
                            ...process.env.WSL_DISTRO_NAME === void 0 ? {} : { distro: process.env.WSL_DISTRO_NAME }
                        });
                    }
                    json(res, 400, {
                        ok: false,
                        error: "unknown action"
                    });
                }
                catch (error) {
                    json(res, 400, {
                        ok: false,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        });
        return () => {
            disposeRoute();
            for (const terminal of terminals.values()) {
                if (terminal.inputTimer !== void 0)
                    clearTimeout(terminal.inputTimer);
                terminal.inputTimer = void 0;
                terminal.pendingInput = "";
                terminal.process.kill("SIGTERM");
            }
            terminals.clear();
            turnGit.clear();
        };
    }, "side-panel: workspace and terminal API");
}
export { apply, inject, name, inside, list, preview, search };
