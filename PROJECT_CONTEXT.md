# Project Context

## Current Repo Shape

This repo is the upstream `mlightcad/cad-viewer` pnpm/Nx monorepo, not a Next.js SaaS app. It contains reusable CAD viewer packages, Vite examples, docs tooling, and GitHub/GitLab Pages deployment flows.

Primary packages:
- `packages/cad-simple-viewer`: framework-agnostic CAD foundation. This is the approved rendering/runtime base.
- `packages/cad-simple-viewer-example`: plain TypeScript + Vite example that uses `@mlightcad/cad-simple-viewer` directly. This is the safest reference path for a custom app.
- `packages/cad-viewer`: Vue 3 + Element Plus full viewer wrapper around `@mlightcad/cad-simple-viewer`. This is not allowed for the target product path.
- `packages/cad-viewer-example`: Vue app that imports `MlCadViewer` from `@mlightcad/cad-viewer`. This is the wrong reference path for a no-Vue/simple-viewer target.
- `packages/three-renderer`: Three.js rendering primitives, batching, camera controls, materials, and transient managers.
- `packages/svg-renderer`: SVG rendering support.
- `packages/examples`: static GitHub/GitLab Pages wrapper that copies built example dists and docs.

## Core Rule

Use `@mlightcad/cad-simple-viewer` as the only CAD rendering foundation for any product/app work. Do not build the target app on `@mlightcad/cad-viewer`, `MlCadViewer`, Vue components, or Element Plus UI wrappers.

## Confirmed Simple Viewer Usage

`packages/cad-simple-viewer-example/src/main.ts` imports `AcApDocManager`, `AcApOpenDatabaseOptions`, and `AcEdOpenMode` from `@mlightcad/cad-simple-viewer`.

Viewer initialization uses:
- `AcApDocManager.createInstance({ container, autoResize, baseUrl, commandAliases, webworkerFileUrls })`
- `baseUrl: https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/`
- worker URLs resolved with `new URL('../workers/...', import.meta.url).href`, so Vite preview, Vercel root deploys, and sub-path static deploys resolve workers from the built app asset location

File loading uses:
- local files: validate `.dxf`/`.dwg`, enforce browser-size limits, read with `File.arrayBuffer()` and fall back to `FileReader.readAsArrayBuffer(file)`, validate the resulting `ArrayBuffer`, then call `AcApDocManager.instance.openDocument(file.name, arrayBuffer, options)`
- remote predefined files: fetch with an abort timeout, enforce `content-length` when present, stream with the same size cap when possible, validate the resulting `ArrayBuffer`, then call `openDocument(fileName, arrayBuffer, options)`
- options include `minimumChunkSize: 1000`, `mode: AcEdOpenMode.Write`, and local-file `lwdisplay: false`

The simple example validates local file names and lightweight CAD signatures before parser handoff:
- DWG must start with an `AC` header.
- DXF must contain a normal DXF section marker or the binary DXF header in the first 4 KiB.

The app preflights required worker URLs with `HEAD` before opening a file, verifies that the response MIME type is JavaScript, and falls back to a tiny ranged `GET` before failing because some dev/static hosts can route `HEAD` through an SPA HTML fallback. It blocks concurrent loads while a drawing is being parsed. Size limits are currently 64 MiB for coarse-pointer or low-memory browsers and 128 MiB otherwise, because worker parsing can duplicate file buffers in memory.

It has click-to-open and predefined-file flows, but no actual drag/drop event handling in the plain TypeScript example.

## Wrong Viewer/Vue Usage Found

Wrong-for-target paths:
- `packages/cad-viewer-example/src/main.ts` creates a Vue app.
- `packages/cad-viewer-example/src/App.vue` imports `MlCadViewer` from `@mlightcad/cad-viewer`.
- `packages/cad-viewer-example/src/components/FileUpload.vue` uses Vue, Element Plus, and an `el-upload` drag UI.
- `packages/cad-viewer/src/**` is a Vue component library with many `.vue` files and Vue composables.

Important bug in the wrong Vue example:
- `App.vue` listens with `@file-select="handleFileSelect"`.
- `FileUpload.vue` declares a required prop `onFileSelect` and calls `props.onFileSelect(...)`.
- It does not `defineEmits(['file-select'])`, so the parent listener does not match the child implementation.

## Viewer Runtime

`AcApDocManager` is a singleton. `createInstance()` only creates a new manager if one does not already exist. `destroy()` unloads plugins and clears the singleton reference, but it does not visibly dispose the view, renderer, DOM listeners, ResizeObserver, or animation loop.

`AcApDocManager` owns:
- current `AcApContext`
- current `AcApDocument`
- current `AcTrView2d`
- command stack
- font loader
- plugin manager
- worker/converter registration

Open flow:
- `openUrl()` and `openDocument()` call `onBeforeOpenDocument()`, reuse the current document/context, then call `onAfterOpenDocument()`.
- The code has TODO comments saying a correct future approach would create a new context instead of reusing the old context and document.
- `onAfterOpenDocument()` sets active layout and zooms to drawing extents or fit.

Worker defaults:
- DXF parser: `./assets/dxf-parser-worker.js`
- DWG parser: `./assets/libredwg-parser-worker.js`
- MTEXT renderer: `./assets/mtext-renderer-worker.js`

The simple example overrides those to `./workers/...` and its Vite config copies worker bundles into `dist/workers`.

## Mobile And Gesture Code

Camera navigation is handled through Three.js `OrbitControls` in `packages/three-renderer/src/viewport/AcTrBaseView.ts`:
- desktop middle mouse pans
- one-finger touch pans
- two-finger touch dollies/pans
- zoom-to-cursor is enabled

Selection and command input are mostly mouse-event based:
- `AcTrView2d` uses `mousedown`, `mousemove`, `mouseup`, and `dblclick` for selection and MTEXT editing.
- `AcEdInputManager` uses mouse events for prompt selection and entity input.
- There is no broad pointer-event pipeline, no pointer capture, and no visible `touch-action` CSS on the CAD canvas.

Mobile risk:
- Pan/zoom may work through `OrbitControls`, but tap selection and command jigs depend on mouse-event compatibility.
- Selection drag and touch pan can conflict unless the app owns explicit priority rules.
- Any mobile SaaS shell should add tested pointer/touch behavior around the simple-viewer foundation.

## Measurement And Overlay Code

Measurement commands live in `packages/cad-simple-viewer/src/command/measure`.

Commands:
- `measuredistance`
- `measurearea`
- `measureangle`
- `measurearc`
- `clearmeasurements`

All measurement commands are read-mode compatible (`AcEdOpenMode.Read`).

Overlay layers:
- CAD transient geometry is added through `context.view.addTransientEntity(...)`.
- Persistent label/dot overlays use `AcTrHtmlTransientManager`, backed by Three.js `CSS2DRenderer`, and are anchored in world coordinates.
- Area, angle, and arc fills use canvas overlays appended to the view container and redrawn on `viewChanged`.
- `AcApClearMeasurementsCmd` runs registered cleanup callbacks and clears HTML transients on the `measurement` layer.

Risks:
- Measurement cleanup callbacks are global module state. Opening a new document clears the view but does not clear the cleanup registry.
- Canvas overlays rely on `viewChanged` listener cleanup; leaks are possible if a command exits through an unhandled branch.
- Live preview overlays are appended to `document.body`, while persistent canvas overlays are appended to the view container. This split needs care in embedded/mobile layouts.

## Entity, Geometry, And Selection

Document-to-view synchronization is in `AcApContext`:
- database `entityAppended` -> `view.addEntity`
- database `entityModified` -> `view.updateEntity`
- database `entityErased` -> `view.removeEntity`
- layer changes update view layer state
- selection set events drive highlight/unhighlight

Rendering flow:
- `AcTrView2d.addEntity()` batches incoming database entities asynchronously.
- `batchConvert()` calls `entity.worldDraw(renderer)` to produce `AcTrEntity`.
- Scene hierarchy is layout -> layer -> render entity.
- `AcTrLayer` stores render entities in `AcTrBatchedGroup`.
- `AcTrScene` manages persistent entities, transient CAD entities, and HTML transients.

Picking and spatial queries:
- `AcTrLayout` keeps an `AcTrHierarchicalSpatialIndex`.
- `AcTrView2d.pick()` creates a world hit box from the screen pick radius, queries the spatial index, validates hits with raycasting, and sorts candidates by bounding-box area then distance.
- Block/group child boxes are indexed for finer selection where available.

Important geometry risks:
- `AcTrLayout.updateEntity()` has a TODO to update the spatial index. Modified entity geometry can leave stale picking/search bounds.
- `AcTrRBushSpatialIndex.load()` bulk-loads the tree but does not populate `idMap`; future callers using `load()` plus `insert/removeById` could see duplicate or stale bookkeeping.
- Infinite rays/xlines are excluded from scene bounding-box extension, which is intentional but important for zoom/fit behavior.

## Build And Deploy Context

There is now a root `vercel.json` that pins Vercel to the simple-viewer build output. There is no Next.js config; this project remains a Vite/static viewer path.

Root tooling:
- package manager: `pnpm@10.33.4`
- root build: filtered simple-viewer workspace build, `@mlightcad/cad-simple-viewer-example...`
- root dev: simple viewer example
- root dev:simple: simple viewer example
- root preview:simple: simple viewer example preview
- root format/lint/test defaults: filtered simple-viewer/core paths only
- root legacy commands: `*:legacy:*` scripts explicitly isolate the Vue/full-viewer example and full-workspace operations for manual upstream maintenance only

Simple example build:
- `packages/cad-simple-viewer-example/package.json`: `tsc && vite build`
- `vite.config.ts`: `base: './'`, `modulePreload: false`, static worker copy to `dist/workers`
- `vite.config.ts` also serves `/workers/*.js` directly in dev with `application/javascript`; otherwise Vite's HTML fallback can return `index.html` for module worker URLs and trigger strict MIME errors.

Library build:
- `packages/cad-simple-viewer/vite.config.ts` builds the library and copies DWG/MTEXT worker bundles into the package dist root.

Pages deploy:
- GitHub Actions uploads `packages/cad-simple-viewer-example/dist` as the Pages artifact.
- GitLab CI copies `packages/cad-simple-viewer-example/dist` into `public`.
- TypeDoc entry points are limited to `packages/cad-simple-viewer`.

Vercel risks:
- Vercel deploys `packages/cad-simple-viewer-example/dist`.
- Worker URLs must exist under the deployed public path; the app now preflights required worker files before parsing to fail fast if Vercel/static paths are wrong.
- The copied CAD worker URLs are resolved from `import.meta.env.BASE_URL` plus the current page URL. Do not use dynamic `new URL(\`../workers/${fileName}\`, import.meta.url)` for these files; Vite can rewrite that pattern into a missing asset lookup and produce `/src/undefined` in dev.
- The examples use remote CDN assets and sample files; a production SaaS should decide whether fonts/sample data are CDN-based or self-hosted.
- The monorepo lockfile and legacy packages still contain Vue dependencies for upstream maintenance, but default build/deploy/docs/test/format paths no longer invoke them.

## Current Highest Risks

1. The upstream monorepo still contains the full Vue viewer and Vue example. Keep target app work isolated to `@mlightcad/cad-simple-viewer` and avoid legacy scripts unless maintaining upstream packages.
2. Vercel now targets the simple viewer, but worker assets must stay present in `dist/workers`.
3. Mobile gestures are not a complete first-class pointer-event system; selection and command prompts are mouse-event driven.
4. Entity modification can leave stale spatial index bounds because `AcTrLayout.updateEntity()` does not update the index.
5. Viewer teardown is incomplete for long-lived SPAs because destroy does not clearly dispose renderers/listeners/animation loop.
6. The simple example does not implement actual drag/drop upload despite docs mentioning drag/drop.
7. Local/remote CAD loads now fail before parsing for oversized files. This protects mobile memory but may reject very large drawings that need a server-side or tiled loading strategy.
8. DWG support depends on worker/WASM paths and LibreDWG limitations.
