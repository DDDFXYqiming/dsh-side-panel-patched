// @vitest-environment jsdom
import DOMPurify from "dompurify";
import { describe, expect, it, vi } from "vitest";

// 隔离客户端 UI 包（其传递依赖在 vitest 的 Node 侧解析链里带 CSS 副作用导入），
// 本文件只验证 dfbRenderMarkdown 的纯函数行为，FishLogo 仅需绑定存在。
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
	FishLogo: () => null
}));

import { dfbRenderMarkdown } from "../src/client/index.ts";

const render = (content: string): string => DOMPurify.sanitize(dfbRenderMarkdown(content));

describe("markdown 渲染 sanitize（marked → DOMParser → DOMPurify）", () => {
	it("剥离 script 标签负载", () => {
		const html = render("before\n\n<script>window.__pwned = true</script>\n\nafter");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("__pwned");
		expect(html).toContain("before");
		expect(html).toContain("after");
	});

	it("剥离事件处理器属性", () => {
		const html = render('<img src="x" onerror="window.__pwned = true">\n<div onload="alert(1)">hi</div>');
		expect(html).not.toMatch(/onerror\s*=/i);
		expect(html).not.toMatch(/onload\s*=/i);
	});

	it("markdown 链接语法里的 javascript: URL 不生成可点击锚点", () => {
		const html = render("[click me](javascript:window.__pwned = true)");
		expect(html).not.toContain("<a");
		expect(html).toContain("click me");
	});

	it("剥离原始 HTML 中的 javascript: 链接", () => {
		const html = render('<a href="javascript:window.__pwned = true">click me</a>');
		expect(html).not.toContain("javascript:");
		expect(html).toContain("click me");
	});

	it("保留正常 markdown 结构", () => {
		const html = render("# 标题\n\n**bold** and `code` and a [link](https://example.com)");
		expect(html).toContain("标题");
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain("<code>code</code>");
		expect(html).toContain("https://example.com");
	});
});
