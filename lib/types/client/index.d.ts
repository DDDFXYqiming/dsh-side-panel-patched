interface ClientContext {
    sessions: {
        list: {
            getSnapshot(): { current?: string };
            subscribe(listener: () => void): () => void;
        };
    };
    workspaces: {
        openPath(path: string): Promise<void>;
    };
    effect(callback: () => (() => void), label?: string): void;
}
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
