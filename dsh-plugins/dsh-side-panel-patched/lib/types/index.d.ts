import type { IncomingMessage, ServerResponse } from 'node:http';
import { type BrowserEntry, type Preview } from './protocol.js'; // [spec-audit 2026-08-14] '.ts' → '.js'：包内只有 .d.ts（TS2307 修复）
interface HostContext {
    sessions: SessionLookup;
    webServer: {
        register(route: {
            kind: 'exact';
            path: string;
            handler(req: IncomingMessage, res: ServerResponse): Promise<void>;
        }): () => void;
    };
    // [spec-audit 2026-08-14] 放宽伪造的 never 签名：声明为通用事件形状（真实签名由宿主类型声明合并提供）
    on(name: string, listener: (...args: any[]) => void): void;
    effect(callback: () => (() => void), label?: string): void;
}
export interface Config {
    maxTextBytes?: number;
    maxImageBytes?: number;
    searchMaxResults?: number;
}
export declare const inject: string[];
declare function inside(root: string, input?: string): {
    absolute: string;
    path: string;
};
declare function list(root: string, input: string): Promise<BrowserEntry[]>;
declare function search(root: string, input: string, limit: number): Promise<{
    matches: BrowserEntry[];
    truncated: boolean;
}>;
declare function preview(root: string, input: string, maxText: number, maxImage: number): Promise<Preview>;
type SessionRecord = {
    id: string;
    header: {
        cwd?: string;
    };
};
type SessionLookup = {
    // [spec-audit 2026-08-14] 修正伪造签名：会话 id 为 string
    get(id: string): SessionRecord | undefined;
};
export declare function apply(ctx: HostContext, config?: Config): void;
export { inside, list, preview, search };
