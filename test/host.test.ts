import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apply, inside } from "../src/host/index.ts";

type Sessions = Record<string, { header: { cwd: string } }>;

function harness(sessions: Sessions) {
	const teardowns: Array<() => void> = [];
	let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined;
	const ctx = {
		on: (_event: string, _listener: (...args: unknown[]) => void) => {},
		effect: (setup: () => unknown) => {
			const teardown = setup();
			if (typeof teardown === "function") teardowns.push(teardown);
		},
		webServer: {
			register: (opts: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => {
				handler = opts.handler;
				return () => {
					handler = void 0;
				};
			}
		},
		sessions: {
			get: (id: string) => sessions[id]
		}
	};
	apply(ctx, {});
	const call = async (
		payload: Record<string, unknown>,
		method: "GET" | "POST" = "POST",
		origin = "http://127.0.0.1:3080",
		url = "/side-panel/api"
	) => {
		const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(payload))]), {
			headers: { host: "127.0.0.1:3080", origin },
			method,
			url
		});
		const out: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
		const res = {
			writeHead: (status: number) => {
				out.status = status;
			},
			end: (text: string) => {
				out.body = JSON.parse(text);
			}
		};
		await handler?.(req, res);
		return out;
	};
	return {
		call,
		dispose: () => {
			for (const teardown of teardowns.splice(0)) teardown();
		}
	};
}

describe("inside — 路径沙箱", () => {
	let root: string;
	let outside: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "spx-root-"));
		outside = mkdtempSync(join(tmpdir(), "spx-out-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});

	it("解析工作区内的路径", () => {
		mkdirSync(join(root, "sub"));
		writeFileSync(join(root, "sub", "a.txt"), "x");
		expect(inside(root, "sub/a.txt")).toEqual({
			absolute: realpathSync(join(root, "sub", "a.txt")),
			path: "sub/a.txt"
		});
	});

	it("允许尚不存在的深层新路径", () => {
		const target = inside(root, "deep/missing/dir/f.txt");
		expect(target.path).toBe("deep/missing/dir/f.txt");
		expect(target.absolute).toBe(join(realpathSync(root), "deep/missing/dir/f.txt"));
	});

	it("拒绝父级穿越", () => {
		expect(() => inside(root, "../evil.txt")).toThrow("path is outside the configured workspace");
	});

	it("拒绝子路径内嵌套的穿越", () => {
		mkdirSync(join(root, "sub"));
		expect(() => inside(root, "sub/../../evil.txt")).toThrow("path is outside the configured workspace");
	});

	it("拒绝指向工作区外的绝对路径", () => {
		expect(() => inside(root, outside)).toThrow("path is outside the configured workspace");
	});
});

describe("inside — 符号链接逃逸", () => {
	let root: string;
	let outside: string;
	let canSymlink = false;

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "spx-link-"));
		outside = mkdtempSync(join(tmpdir(), "spx-link-out-"));
		mkdirSync(join(root, "real"));
		try {
			const type = process.platform === "win32" ? "junction" : "dir";
			symlinkSync(join(root, "real"), join(root, "in-link"), type);
			symlinkSync(outside, join(root, "out-link"), type);
			canSymlink = true;
		} catch {
			canSymlink = false;
		}
	});
	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});

	it("解析指向工作区内的符号链接", (ctx) => {
		if (!canSymlink) ctx.skip();
		expect(inside(root, "in-link").path).toBe("real");
	});

	it("拒绝指向工作区外的符号链接", (ctx) => {
		if (!canSymlink) ctx.skip();
		expect(() => inside(root, "out-link")).toThrow("path is outside the configured workspace");
	});
});

describe("终端会话所有权与请求边界", () => {
	const isWin = process.platform === "win32";
	let rootA: string;
	let rootB: string;
	let h: ReturnType<typeof harness>;

	beforeEach(() => {
		rootA = mkdtempSync(join(tmpdir(), "spx-a-"));
		rootB = mkdtempSync(join(tmpdir(), "spx-b-"));
		h = harness({ "sess-a": { header: { cwd: rootA } }, "sess-b": { header: { cwd: rootB } } });
	});
	afterEach(async () => {
		h.dispose();
		await rm(rootA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
		await rm(rootB, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
	});

	it("拒绝不带 Origin 的变更请求（CSRF 兜底）", async () => {
		const out = await h.call({ action: "terminal-open", sessionId: "sess-a" }, "POST", "");
		expect(out.status).toBe(403);
		expect(out.body.error).toBe("forbidden origin");
	});

	it("拒绝 GET 形式的变更请求", async () => {
		const out = await h.call({}, "GET", "", "/side-panel/api?action=terminal-input&sessionId=sess-a");
		expect(out.status).toBe(405);
		expect(out.body.error).toBe("mutating actions require POST");
	});

	it("拒绝跨源 Origin", async () => {
		const out = await h.call({ action: "terminal-open", sessionId: "sess-a" }, "POST", "http://evil.example");
		expect(out.status).toBe(403);
		expect(out.body.error).toBe("forbidden origin");
	});

	it("拒绝外部会话操作终端，接受属主会话", async () => {
		const opened = await h.call({ action: "terminal-open", sessionId: "sess-a" });
		expect(opened.status).toBe(200);
		const id = String((opened.body.pty as { id: string }).id);
		expect(id).toMatch(/^side-pty-/);
		const foreign = await h.call({ action: "terminal-input", sessionId: "sess-b", terminalId: id, data: "ls\r" });
		expect(foreign.status).toBe(400);
		expect(foreign.body.error).toBe("terminal is unavailable");
		const own = await h.call({ action: "terminal-input", sessionId: "sess-a", terminalId: id, data: isWin ? "echo PTY-%OS%\r" : "printf 'PTY-%s\\n' linux\r" });
		expect(own.status).toBe(200);
		expect(own.body.accepted).toBe(true);
		let output = "";
		await expect.poll(async () => {
			const read = await h.call({ action: "terminal-read", sessionId: "sess-a", terminalId: id });
			output += (read.body.pty as { output: string }).output;
			return output;
		}, { timeout: 10000 }).toContain(isWin ? "PTY-Windows_NT" : "PTY-linux");
		const resize = await h.call({ action: "terminal-resize", sessionId: "sess-a", terminalId: id, cols: 100, rows: 30 });
		expect(resize.body.applied).toBe(isWin);
		const closed = await h.call({ action: "terminal-close", sessionId: "sess-a", terminalId: id });
		expect(closed.status).toBe(200);
	});

	it("拒绝访问不存在的终端", async () => {
		const out = await h.call({ action: "terminal-input", sessionId: "sess-a", terminalId: "side-pty-999", data: "x" });
		expect(out.status).toBe(400);
		expect(out.body.error).toBe("terminal is unavailable");
	});
});
