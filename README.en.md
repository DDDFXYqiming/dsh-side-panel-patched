[简体中文](README.md) | English

# dsh-side-panel-patched

A locally enhanced (fork-maintained) version of the DSH Web right-side workspace panel (file browser / Git review / terminal).

## Origin

- Upstream project: [ccq1/dsh-side-panel](https://github.com/ccq1/dsh-side-panel) (BSD-3-Clause, v0.2.0, install source `github:ccq1/dsh-side-panel`)
- Upstream capabilities: right-side panel = file tree/preview/editing (CodeMirror) + Git review + terminal (xterm); the Node side provides `/side-panel/api` (file/Git/terminal APIs)
- This directory is the upstream code plus local enhancements from 2026-08-14 (all changes carry a `PATCH(2026-08-14)` marker and can be located with grep)

## Enhancements (relative to upstream v0.2.0)

### 1. Panel mounting: bypass the official details column's 520px width cap (v4)

Upstream mounts the panel into the detailsCol of DSH's official three-column grid (sidebar | conversation | details) — but the official column width is hard-capped at 520px by `clampWidth(px, 300, 520)` (a limit in the `dsh-client-ui-layout` source that plugins cannot override).

This version instead **does not rely on the official details column** (zero official source modifications):
- The panel is `position:fixed` on the right edge of the viewport with free width (**420px ~ 60% of the viewport**)
- The official center column gets a runtime `padding-right = panel width` → the chat area is squeezed (equivalent to a true right sidebar)
- Dragging uses the plugin's own resizer; width is persisted in `localStorage["dsh.file-browser.width"]` (default 600)

### 2. Header structure pixel-aligned with the official header

The official header is a "44px title row + 28px tabs row" (divider at y=75); the panel header mirrors it:
- Row 1 `dfb-head` 44px (padding-top 12px, aligned with the official title row)
- Row 2 `dfb-file-toolbar` 30px (padding-top 4px, aligned with the official tabs row)
- The divider (toolbar border-bottom) sits at y=74, **adjacent and continuous** with the official header:after line (bottom:1px + 1px height → actually y=74)
- The divider color uses the same official `--dsw-alias-border-l2` plus a subtle shadow

### 3. Spindle-shaped drag-handle animation (Codex style)

On hover/drag, a pure linear spindle shape is shown (a diamond via `clip-path: polygon(50% 0,0% 50%,50% 100%,100% 50%)`, tapering to zero at both ends),
light gray `rgba(128,128,128,.3)`, with a 0.15s fade-in transition.

### 4. Windows terminal protection (prevents host crash)

The upstream terminal is a pure Unix implementation (`spawn("script", ...)` + hard-coded `/bin/bash`); on Windows it hits ENOENT with no error handling → **an uncaught error takes down the host process directly** (crash confirmed in testing). This version:
- `terminal-open` returns a friendly error on Windows (no spawn) — the frontend shows "The terminal feature is not yet supported on Windows (PTY depends on the Unix script command)"
- All spawns get an `error` handler attached (prevents crashes from platform issues of any kind)
- Single-command mode uses `cmd.exe /c` on Windows

### 5. Service injection fix

`exports.inject` now declares the `layout` service (its absence in the original caused `ctx.layout` access to fail with "cannot get property layout without inject").

### 6. Maximize button full-width toggle (v5)

`⛶` expand = panel width goes to **60% of the viewport** (the pre-expand width is remembered); clicking again restores the pre-expand width (dragged values are not lost); the expanded state is not persisted.

### 7. Multi-file tab stack (v6, Codex-style)

- Clicking a file in the tree opens an **independent tab** (multiple files can be open at once; tabs can be switched, closed individually, and re-clicking the same path activates the existing tab)
- **Tree singleton follows** the active file tab (preview on the left + tree on the right); the tree's scroll position is preserved across tabs (forced reflow + rAF as a double safeguard)
- After the first file is opened, the **"Files" feature tab is automatically hidden** (a redundant entry point); it is restored once all file tabs are closed
- The file tab view drops the redundant path bar (the tab label is the file name)
- **Session (workspace) tracking**: switching workspaces → the tree reloads for the current workspace; file tabs are **grouped by session** (v6h) — only tabs of the current workspace are shown, each preserved independently with no cross-talk between switches; switching sessions causes no blank screen and does not revive the "Files" feature tab

## Installation

Install from GitHub (recommended):

```bash
dsh plugin --profile web add github:DDDFXYqiming/dsh-side-panel-patched
# For local development, you can also use the repository directory directly
dsh plugin --profile web add <this directory>
```

## Release Form (since 2026-08-14)

- This package **distributes pre-built artifacts only** (`lib/` is build output; the repo has no `src/`/`tsconfig.json`) — the `prepare` script only self-checks artifact presence, so both `npm pack` and GitHub installation succeed (the publish.md-compatible path)
- The scoped package is configured with `publishConfig.access: public`; all frontend dependencies (codemirror/xterm etc.) are inlined into the bundle and declared in `devDependencies` (used at build time)
- Config defaults are provided by the in-plugin Schemastery `Config` (`maxTextBytes` / `maxImageBytes` / `searchMaxResults`); `cordis.patch.yml` no longer carries default values
- `/side-panel/api` now performs Host/Origin loopback validation (only accepts `127.0.0.1` / `localhost` / `[::1]` origins)

## Known Limitations

- The terminal feature is unavailable on Windows (Unix PTY limitation; the author would need to switch to ConPTY/node-pty)
- The panel overlays the official detailsCol (the official "tool call details" panel is covered)
- Browser-side plugin: changes to `lib/client.js` require a hard refresh to take effect; Node-side changes to `lib/index.js` require restarting the host
- `findFrameParts` locates the official layout via `[data-details-collapsed]` / `[class*="centerCol"]` (hash class suffixes are stable); if a major DSH upgrade changes the structure, re-adaptation will be needed

## License

BSD-3-Clause (the upstream copyright notice is retained; see LICENSE)
