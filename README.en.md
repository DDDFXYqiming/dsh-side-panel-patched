[简体中文](README.md) | English

# dsh-side-panel-patched

Local enhancement fork of the DSH Web right-side workspace panel (file browser / Git review / terminal).

- **Upstream**: [ccq1/dsh-side-panel](https://github.com/ccq1/dsh-side-panel) (BSD-3-Clause, v0.2.0, install source `github:ccq1/dsh-side-panel`) — right-side panel = file tree / preview / edit (CodeMirror) + Git review + terminal (xterm); Node side exposes `/side-panel/api` (file / Git / terminal APIs)
- **This directory** = upstream source + 2026-08-14 local enhancements (every change is tagged `PATCH(2026-08-14)`, findable via `grep`)

## Enhancements (vs upstream v0.2.0)

Implementation details live inside the source as `PATCH(2026-08-14)` markers and in CHANGELOG.md / git log; high-level: independent panel mount (no dependency on the official `details` column, bypasses the 520px width cap, `position: fixed` on the right with a 420px ~ 60% viewport draggable width, width persisted); 44px title + 28px tabs header pixel-aligned with the official UI; Codex-style spindle drag handle; Windows terminal safety (friendly error instead of spawning on unsupported paths, error handlers on every spawn, single-command mode uses `cmd.exe /c`); `ctx.sessions` / `ctx.workspaces` service injection declarations backfilled (session-switch tracking, per-session file tab grouping); maximize button toggles between 60% viewport and full width without losing the drag value; multi-file tab stack (tree singleton follows the active tab, scroll position preserved across tabs, first file auto-hides the `Files` feature tab, tabs are grouped per session / workspace and never cross-contaminate).

## Install

```bash
# From GitHub (recommended)
dsh plugin --profile web add github:DDDFXYqiming/dsh-side-panel-patched
# Or from a local dev checkout
dsh plugin --profile web add <repo dir>
```

## Distribution shape

- This package **ships prebuilt output** (`lib/` is the build output; `src/` + `tsconfig.json` are the source of truth, `npm run build` = host + client → `lib/`) — the `prepare` script only checks output presence; `npm pack` and GitHub installs both pass (publish.md compatibility path)
- The scoped package is configured with `publishConfig.access: public`; all frontend dependencies (codemirror / xterm / etc.) are inlined into the bundle and declared under `devDependencies` (build-time only)
- Default config is provided by the plugin's built-in Schemastery `Config` (`maxTextBytes` / `maxImageBytes` / `searchMaxResults`); `cordis.patch.yml` no longer carries defaults
- `/side-panel/api` enforces a Host/Origin loopback check (only `127.0.0.1` / `localhost` / `[::1]` are accepted)

## Known limits

- Terminal feature is unavailable on Windows (Unix PTY required; switch to ConPTY / node-pty)
- The panel overlays the official `detailsCol` (the official "tool-call details" panel is occluded)
- Browser-side plugin: changes to `lib/client.js` require a hard reload; changes to Node-side `lib/index.js` require a host restart
- `findFrameParts` uses `[data-details-collapsed]` / `[class*="centerCol"]` to locate the official layout (the hashed class suffix is stable); DSH major-version upgrades that change structure will need a re-fit

## License

BSD-3-Clause (upstream copyright preserved, see LICENSE)
