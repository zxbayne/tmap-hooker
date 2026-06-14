# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build          # Full production build (copy-assets + hook + panel)
npm run build:hook     # Build only the hook script (src/hook → dist/hook.iife.js)
npm run build:panel    # Build only the panel script (src/panel → dist/panel.iife.js)
npm run dev            # Watch mode for both scripts (uses concurrently)
npm run copy-assets    # Copy manifest.json and icons to dist/
```

There are no tests or linting scripts. TypeScript type checking is the primary correctness check — `tsconfig.json` has `"noEmit": true`.

To load in Chrome after building: `chrome://extensions` → Developer mode → Load unpacked → select `dist/`.

## Two-World Architecture

This extension runs two completely separate scripts that cannot share memory:

| Script | World | Entry | manifest config |
|--------|-------|-------|-----------------|
| `hook.iife.js` | MAIN (page context) | `src/hook/index.ts` | `"world": "MAIN"`, `document_start` |
| `panel.iife.js` | ISOLATED (content script) | `src/panel/index.ts` | `document_idle` (default) |

**Communication** is exclusively via `window.postMessage`. Every message carries a `source` field (`'tmap-hook'` or `'tmap-panel'`) to distinguish extension messages from page-level postMessages. All message types, payload interfaces, and the two send helpers (`sendToPanel` / `sendToHook`) are defined in `src/shared/protocol.ts`.

## Hook Layer (`src/hook/`)

The hook runs in MAIN world so it can access `window.TMap`.

**TMap detection** (`map-bridge.ts`): Uses dual strategy — an `Object.defineProperty` setter trap on `window.TMap` (catches late loads) and a 200ms polling interval up to 50 attempts (catches early loads). Both paths call `tryPrototypePatch`, which wraps methods on `TMap.Map.prototype` to intercept the first map method call and capture the instance. An `__tmapHookerPatched` flag makes this idempotent.

**Tool plugin system** (`tools/`): Each tool implements `ITool` (`activate / deactivate / reset`). `ToolManager` holds the registry and active tool, injects a `ToolContext` (map instance + `OverlayManager`) on activation. To add a new tool: implement `ITool`, register it in `ToolManager`'s constructor, add metadata to `src/shared/tool-config.ts`, route new `PanelCmd`s in `src/hook/index.ts`.

**Overlay management** (`overlay-manager.ts`): Lazy-initializes TMap Multi* layers. Two categories with different lifetimes:

| Layer | Fields | Cleared by |
|-------|--------|-----------|
| Measurement markers, polylines, labels | `markerLayer`, `polylineLayer`, `labelLayer` | `clearMeasurement()` and `clearAll()` |
| Polygons, rubber band | `polygonLayer`, `rubberBandLayer` | `clearAll()` only |
| Point marker pins + name labels | `pointMarkerLayer`, `pointLabelLayer` | `clearAll()` only |

Point marker layers cache names (`pointMarkerNames`) so that highlight/visibility updates don't accidentally blank the label text. `setTool()` skips `clearMeasurement()` for both `polygon` and `point-marker` tools (defined via `PERSISTENT_TOOLS` set).

**Panel-triggered map panning**: `PolygonTool.selectById(id, panToLocation)` and `PointMarkerTool.selectById(id, panToLocation)` accept an optional second argument. When `true` (passed only by `ToolManager` in response to panel `SELECT_*` commands), the tool calls `map.panTo(center)` (falling back to `setCenter`) before emitting the selection event. Direct map-click selection paths pass no second arg, so they never auto-pan.

**Debug logging** (`logger.ts`): All hook-layer console output goes through `log()`, which gates on `debugEnabled`. Initial state is read from `localStorage.__tmh_settings__` at startup; toggled at runtime via `SET_DEBUG` panel command.

## Panel Layer (`src/panel/`)

The panel mounts a Vue 3 app inside a **Shadow DOM** (`host.attachShadow({ mode: 'open' })`) to fully isolate from the page's CSS. The CSS is imported with `?inline` and manually injected into the shadow root.

**`vite.config.panel.ts` requires `define: { 'process.env.NODE_ENV': JSON.stringify('production') }`** — without this, Vue references `process.env.NODE_ENV` at runtime and throws `ReferenceError: process is not defined` in the IIFE context.

**State management** (`composables/useTool.ts`): Central reactive store for all tool state. Subscribes to all `HookEvent`s via `useMapBridge` and exposes command functions. Key exported types:
- `PolygonLayer` — id, name, visible, selected, coords (vertices for export)
- `PointMarkerItem` — id, name, visible, selected, lat, lng

Point marker selection supports multi-select: `selectPointMarkerFromPanel(id, multiSelect)`. When `multiSelect=true` (Shift held in `PointPanel.vue`), toggles the clicked item without clearing others and skips the hook `SELECT_POINT_MARKER` command. When `false`, deselects all others and sends the command (triggering map highlight + pan).

**Message bridge** (`composables/useMapBridge.ts`): Module-level singleton handlers array with a single `window.addEventListener`. Per-component registration would create duplicate listeners if Vue remounts. Sends `PANEL_READY` on mount so the hook can replay `MAP_READY` if it fired before the panel loaded.

## Coordinate Utilities (`src/shared/utils/parse-coords.ts`)

| Function | Min points | Formats |
|----------|-----------|---------|
| `parseCoords(input)` | 3 | `[[lng,lat],...]` · `lng,lat;lng,lat;...` |
| `parsePointCoords(input)` | 1 | `[lng,lat]` (1D) · `[[lng,lat],...]` (2D) · `lng,lat;...` |
| `coordsToText(points)` | — | serializes to `[[lng,lat],...]` |

`parsePointCoords` distinguishes 1D vs 2D by prefix: `[[` → multi-point array, `[` → single point, `;` present → semicolon format.

## Build System Notes

- Rollup cannot do multiple IIFE entries in one config — hence two separate `vite.config.*.ts` files.
- Both configs use `inlineDynamicImports: true` (required for IIFE) and `emptyOutDir: false` (so each build doesn't delete the other's output).
- `minify: false` is intentional for debuggability.
- Path aliases: `@shared/*` → `src/shared/`, `@hook/*` → `src/hook/`, `@panel/*` → `src/panel/`.
