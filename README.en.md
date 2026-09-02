[简体中文](README.md) | English

# dsh-side-panel-patched

Local enhancement fork of the DSH Web right-side workspace panel (file browser / Git review / terminal), maintained as a fork.

- Upstream is [ccq1/dsh-side-panel](https://github.com/ccq1/dsh-side-panel) (BSD-3-Clause, v0.2.0, install source `github:ccq1/dsh-side-panel`). It provides the base panel with the file tree, preview, editing (CodeMirror), Git review and terminal (xterm), and the Node side exposes `/side-panel/api` (file / Git / terminal APIs)
- This repository layers local enhancements on top of the upstream code. Every change carries a `PATCH(2026-08-14)`, `PATCH(2026-08-21)` or `PATCH(2026-08-27)` marker in the source, `grep` finds them directly, and git log holds the full history

## Enhancements (vs upstream v0.2.0)

Implementation details sit next to the `PATCH` markers in the source, and git log has the complete history. The list below covers the highlights.

- **Independent panel mount**. The panel mounts in its own anchor, bypassing the official details column and its 520px width cap. It sits on the right with `position:fixed`, drags between 420px and 60% of the viewport, and the chosen width persists
- **Header matched to the official UI**. 44px title bar plus 28px tabs bar, pixel-tight
- **Codex-style spindle drag handle**
- **Windows terminal safety**. Unsupported paths return a friendly error without spawning a process, every spawn carries an error handler, and single-command mode goes through `cmd.exe /c`
- **`ctx.sessions` / `ctx.workspaces` service injection declarations backfilled**. Session switches are tracked, and file tabs group by session
- **Terminal session ownership** (`PATCH(2026-08-27)`). The host validates every `terminal-*` action against `owner=sessionId`, so polling, input, resize and close are all bound to the session the terminal was opened in
- **Maximize button** toggles between 60% viewport and full width, and the drag value survives
- **Multi-file tab stack**. The tree is a singleton that follows the active tab, scroll position is preserved across tabs, opening the first file auto-hides the `Files` feature tab, and tabs are grouped per session / workspace so they never cross-contaminate

### Markdown preview enhancements (2026-08-21, `PATCH(2026-08-21)`)

- GitHub-style typography that adapts to light and dark themes, lezer syntax highlighting inside code fences (the parsers are reused from the plugin's built-in CodeMirror, so no new dependencies), and a language badge on each fence
- `mermaid` code fences render on demand to SVG. The engine lazy-loads from a CDN (jsdelivr first, then unpkg, `mermaid@11.17.0`), the theme follows DSH and re-renders on switches, and the output passes through DOMPurify. Offline, CSP-blocked or invalid syntax falls back to the source view
- Entry points live in `lib/client.js` as `dfbRenderMarkdown` / `markdownCss` / `dfbRenderMermaidBlocks`. `src/` holds the source, and `npm run build` builds `lib/` from `src/host` and `src/client`

## Install

```bash
# From GitHub (recommended)
dsh plugin --profile web add github:DDDFXYqiming/dsh-side-panel-patched
# Or from a local dev checkout
dsh plugin --profile web add <repo dir>
```

## Distribution shape

- The plugin loads `lib/`, and the package ships prebuilt output. `src/` and `tsconfig.json` are the single source of truth, and `npm run build` builds host and client into `lib/` (the host file is transpiled through typescript to strip types). The `prepare` script runs the full `build + check`, so `npm pack` and GitHub installs rebuild `lib/`; on the first pnpm >= 10 git install, add the printed package key under `allowBuilds:` in the profile's `pnpm-workspace.yaml`
- The scoped package sets `publishConfig.access: public`. All frontend dependencies (codemirror / xterm / etc.) are inlined into the bundle and declared under `devDependencies` (build-time only)
- Config defaults come from the plugin's built-in Schemastery `Config` (`maxTextBytes` / `maxImageBytes` / `searchMaxResults` / `terminalTimeoutMs` / `searchNodeBudget`), and `cordis.patch.yml` no longer carries defaults
- `/side-panel/api` enforces a Host / Origin loopback check that only accepts `127.0.0.1` / `localhost` / `[::1]`

## Known limits

- The terminal feature is unavailable on Windows because Unix PTYs do not exist there; supporting it would mean moving to ConPTY / node-pty
- The panel overlays the official `detailsCol`, so the official "tool-call details" panel is occluded
- This is a browser-side plugin. Changes to `lib/client.js` need a hard reload to take effect, and changes to the Node-side `lib/index.js` need a host restart
- `findFrameParts` locates the official layout with `[data-details-collapsed]` / `[class*="centerCol"]` (the hashed class suffix is stable). A DSH major upgrade that changes the structure will need a re-fit here

## License

MIT (see the LICENSE file). Upstream [ccq1/dsh-side-panel](https://github.com/ccq1/dsh-side-panel) was originally BSD-3-Clause, and its attribution is preserved in LICENSE
