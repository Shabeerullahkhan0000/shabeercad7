# Task Log

## 2026-05-15 - Verify Vercel Deploy Readiness

Completed work:
- Inspected deploy-facing config without rewriting or restructuring the app.
- Confirmed root `package.json` defaults keep Vercel on the filtered simple-viewer/core build path: `pnpm --filter @mlightcad/cad-simple-viewer-example... run build`.
- Confirmed `pnpm-workspace.yaml` includes `packages/*` and does not force a Vue/full-viewer deploy path.
- Confirmed `nx.json` only adds cached build dependency ordering; root Vercel build does not rely on Nx.
- Confirmed `vercel.json` uses `pnpm install --frozen-lockfile`, `pnpm run build`, `packages/cad-simple-viewer-example/dist`, and `vite`.
- Confirmed `packages/cad-simple-viewer-example/vite.config.ts` copies production workers to `dist/workers` and serves the same workers with JavaScript MIME in dev.
- Confirmed production DWG support does not require a separate `.wasm` deploy artifact; the DWG worker contains embedded `data:application/wasm`.
- Confirmed local file upload and predefined-file loading stay on `@mlightcad/cad-simple-viewer` and `openDocument()` with worker preflight and `ArrayBuffer` validation.

Files changed:
- `TASK_LOG.md`
- `NEXT_TASK.md`

Test steps:
- `pnpm run build` passed outside the sandbox. Build scope remained `@mlightcad/svg-renderer`, `@mlightcad/three-renderer`, `@mlightcad/cad-simple-viewer`, and `@mlightcad/cad-simple-viewer-example`.
- Production preview smoke passed from built output:
  - `/` returned `200 text/html`
  - `/assets/main-CC2gLCsu.js` returned `200 text/javascript`
  - `/workers/dxf-parser-worker.js` returned `200 text/javascript`
  - `/workers/libredwg-parser-worker.js` returned `200 text/javascript`
  - `/workers/mtext-renderer-worker.js` returned `200 text/javascript`
- Confirmed `dist/workers` contains DXF, DWG, and MTEXT worker bundles.
- Final target-path scan found no `@mlightcad/cad-viewer`, `MlCadViewer`, Vue, or Element Plus usage in the simple app/source path. Remaining matches are legacy root scripts or dependency metadata only.

Risks/limitations:
- Headless browser CAD-load smoke did not run because Playwright's Chromium binary is not installed locally. No browser installation was performed during this deploy-only pass.
- The app still emits the existing Vite large-chunk warning for the CAD runtime bundle.
- Remote predefined DWG/DXF files depend on CDN availability and browser CORS behavior.
- Large CAD files are intentionally capped in-browser to protect mobile memory.
- Root monorepo metadata still contains legacy Vue/full-viewer packages, but Vercel build/deploy defaults do not invoke them.

Next task:
- Run a real browser smoke on the deployed or previewed app: load one predefined DXF, one predefined DWG, and one local DXF upload, then check the console for worker, MIME, CORS, and parser errors.

Follow-up localhost fix:
- User reported local upload still failing with `Required CAD worker returned text/html`.
- Verified the refreshed localhost worker URLs now return JavaScript for both `127.0.0.1:5175` and `localhost:5175`.
- Hardened worker preflight so `HEAD` returning an HTML fallback no longer immediately fails; it now retries a small ranged `GET`, accepts valid JavaScript responses, and reports the exact worker URL/status/MIME if both checks fail.
- Restarted localhost at `http://127.0.0.1:5175/` with PID `2796`.

Follow-up verification:
- `pnpm --filter @mlightcad/cad-simple-viewer-example run lint` passed.
- `pnpm --filter @mlightcad/cad-simple-viewer-example run build` passed outside the sandbox.
- Confirmed `HEAD /workers/dxf-parser-worker.js`, `HEAD /workers/libredwg-parser-worker.js`, and `HEAD /workers/mtext-renderer-worker.js` return `200 application/javascript; charset=utf-8` on both localhost hostnames.

Follow-up worker URL fix:
- User reported the app still preflighting `http://127.0.0.1:5175/src/undefined` for `mtext-renderer-worker.js`.
- Found Vite was rewriting the dynamic `new URL(\`../workers/${fileName}\`, import.meta.url)` expression into an empty asset map lookup, producing `undefined` in dev.
- Changed simple viewer worker URL resolution to derive `/workers/<file>` from `import.meta.env.BASE_URL` and the current page URL, avoiding Vite's dynamic `import.meta.url` asset transform while keeping Vercel/static-base behavior safe.

Follow-up worker URL verification:
- `pnpm --filter @mlightcad/cad-simple-viewer-example run lint` passed.
- `pnpm --filter @mlightcad/cad-simple-viewer-example run build` passed.
- `pnpm run build` passed through the filtered simple-viewer workspace build path.
- Confirmed the emitted production bundle no longer contains `src/undefined`, `Object.assign({})` worker lookups, or `../workers/` dynamic asset references.
- Confirmed `packages/cad-simple-viewer-example/dist/workers` contains DXF, DWG, and MTEXT worker bundles.

## 2026-05-15 - Harden Simple Viewer Upload Loading

Completed work:
- Kept the fix scoped to `packages/cad-simple-viewer-example` and direct `@mlightcad/cad-simple-viewer` usage.
- Resolved DXF, DWG, and MTEXT worker URLs from `import.meta.url` instead of fragile relative strings.
- Added worker `HEAD` preflight before file parsing so Vercel/static-path failures surface as a clear error instead of a hanging parser.
- Added guarded loading state to block concurrent opens and keep the empty state visible when a first load fails.
- Validated file extension, empty files, browser-size limits, and lightweight DXF/DWG signatures before handing buffers to the parser.
- Switched local upload reading to `File.arrayBuffer()` with a strict `FileReader.readAsArrayBuffer` fallback.
- Replaced predefined-file `openUrl()` with an app-level fetch path that uses abort timeout, content-length checks, streaming size checks, `ArrayBuffer` validation, and `openDocument()`.
- Updated project context and next-task notes.

Files changed:
- `packages/cad-simple-viewer-example/src/main.ts`
- `PROJECT_CONTEXT.md`
- `TASK_LOG.md`
- `NEXT_TASK.md`

Test steps:
- `pnpm run lint` passed for the filtered simple-viewer/core path.
- `pnpm run build` passed outside the sandbox after the known esbuild sandbox access-denied issue. The Vercel/root build still targets only the simple-viewer workspace path.
- Preview smoke test passed: `HEAD /`, `HEAD /workers/dxf-parser-worker.js`, `HEAD /workers/libredwg-parser-worker.js`, and `HEAD /workers/mtext-renderer-worker.js` all returned 200.
- Dev-server smoke test passed for the same worker `HEAD` URLs.
- `pnpm test` passed: 25 suites, 70 tests.

Risks/limitations:
- The loading path now rejects files over 64 MiB on coarse-pointer or low-memory browsers and 128 MiB elsewhere to avoid mobile memory crashes. Very large drawings need a dedicated server-side or tiled loading plan.
- Worker preflight assumes the static host supports `HEAD`; Vercel and Vite preview do.
- This did not change measurement, overlays, entity geometry, gestures, or the Vue/full-viewer packages.
- The production bundle still emits the existing Vite large-chunk warning. Lazy-loading the CAD runtime is a separate optimization.

Next task:
- Browser-smoke one actual predefined DXF and DWG load on desktop and mobile viewport, then add real drag/drop only in the simple app shell if upload UX is next.

Follow-up fix:
- Fixed local Vite dev worker serving after browser console showed module worker MIME errors. `/workers/*.js` was getting Vite's HTML fallback in dev, so the browser rejected worker module scripts.
- Added a simple dev-server middleware in `packages/cad-simple-viewer-example/vite.config.ts` to serve DXF, DWG, and MTEXT worker files with `application/javascript`.
- Normalized static-copy source paths for the same workers.
- Tightened app worker preflight to reject non-JavaScript MIME types instead of accepting any `200` response.

Follow-up verification:
- Restarted localhost at `http://127.0.0.1:5175/`.
- Confirmed `HEAD /workers/dxf-parser-worker.js`, `HEAD /workers/libredwg-parser-worker.js`, and `HEAD /workers/mtext-renderer-worker.js` return `200 application/javascript; charset=utf-8`.
- `pnpm --filter @mlightcad/cad-simple-viewer-example run lint` passed.
- `pnpm --filter @mlightcad/cad-simple-viewer-example run build` passed outside the sandbox.

## 2026-05-15 - Isolate Simple Viewer App Path

Completed work:
- Changed root default scripts so `build`, `dev`, `preview`, `serve`, `lint`, and `test` use the `@mlightcad/cad-simple-viewer` / simple-example path instead of the Vue/full-viewer example.
- Kept the Vue/full-viewer package and full-workspace operations available only through explicit `legacy` scripts for upstream maintenance.
- Narrowed the default formatter to simple-viewer/core package paths and kept all-package formatting behind a legacy script.
- Added `vercel.json` so Vercel builds the simple viewer and serves `packages/cad-simple-viewer-example/dist`.
- Updated GitHub Pages and GitLab Pages deployment config to publish the simple viewer dist instead of the combined examples site.
- Limited TypeDoc entry points to `packages/cad-simple-viewer`.
- Removed the simple example README nudge toward the full Vue `@mlightcad/cad-viewer` package.
- Updated project context and next-task notes.

Files changed:
- `package.json`
- `typedoc.json`
- `vercel.json`
- `.github/workflows/ci.yml`
- `.gitlab-ci.yml`
- `packages/cad-simple-viewer-example/README.md`
- `PROJECT_CONTEXT.md`
- `TASK_LOG.md`
- `NEXT_TASK.md`

Test steps:
- `pnpm install --frozen-lockfile` succeeded.
- `pnpm run build` succeeded after rerunning outside the sandbox because esbuild hit a sandbox directory access denial. The build scope was `@mlightcad/svg-renderer`, `@mlightcad/three-renderer`, `@mlightcad/cad-simple-viewer`, and `@mlightcad/cad-simple-viewer-example`.
- Confirmed `packages/cad-simple-viewer-example/dist/workers` contains DXF, DWG, and MTEXT worker bundles.
- `pnpm run lint` passed for the filtered simple-viewer/core path.
- `pnpm test` passed: 25 suites, 70 tests. Jest still printed its existing open-handle warning after success.
- Final scan found no `@mlightcad/cad-viewer`, `MlCadViewer`, Vue, or Element Plus usage in the simple app/source path. Remaining root matches are legacy scripts and monorepo dependency metadata only.

Risks/limitations:
- The legacy Vue/full-viewer packages still exist in the monorepo for upstream compatibility, but default app/build/deploy scripts no longer use them.
- Vercel install still uses the workspace lockfile; runtime output is isolated to the simple viewer dist.
- Mobile gesture limitations remain in the underlying simple viewer and should be addressed separately.

Next task:
- Add a small browser smoke test for the simple viewer output and worker asset availability.

## 2026-05-15 - Inspect CAD Viewer Architecture

Completed work:
- Inspected repo rules, package boundaries, viewer imports, initialization flow, upload flow, mobile gesture code, measurement/overlay code, entity/geometry code, and build/deploy config.
- Created `PROJECT_CONTEXT.md` with the durable architecture notes and current risk map.
- Confirmed `packages/cad-simple-viewer-example` is the safe direct `@mlightcad/cad-simple-viewer` reference.
- Confirmed `packages/cad-viewer` and `packages/cad-viewer-example` are Vue/full-viewer paths and should not be used for the target product foundation.
- Found a Vue example upload mismatch: parent listens for `file-select`, child expects an `onFileSelect` prop and does not emit `file-select`.
- Confirmed no Vercel config exists in the repo.

Files changed:
- `PROJECT_CONTEXT.md`
- `TASK_LOG.md`
- `NEXT_TASK.md`

Test steps:
- Inspection-only task; no source code changes.
- Used repo searches and file reads to trace imports, viewer init, upload, gestures, measurement overlays, spatial indexing, and build config.
- Did not run build/tests because the requested task was inspect-only.

Risks/limitations:
- Existing working tree already had unrelated/unreviewed state before this task: modified `README.zh-CN.md` and untracked `AGENT_RULES.md`, `TASK_LOG.md`, and `NEXT_TASK.md`.
- This audit did not validate runtime behavior in a browser.
- Build/Vercel findings are static-inspection findings only.

Next task:
- Decide the actual deployable target: either keep this monorepo as library/examples, or create/configure a dedicated simple-viewer app for Vercel that uses only `@mlightcad/cad-simple-viewer`.

## 2026-05-15 - Add Agent Rules

Completed work:
- Added `AGENT_RULES.md` with CAD SaaS architecture, mobile-first performance, AI-readiness, debugging, deployment, quality, shortcut command, and output requirements.
- Added `TASK_LOG.md` so future changes have a persistent project log.
- Added `NEXT_TASK.md` so future agents can continue from a clear next step.

Files changed:
- `AGENT_RULES.md`
- `TASK_LOG.md`
- `NEXT_TASK.md`

Test steps:
- Documentation-only change; no build or automated tests required.

Risks/limitations:
- `PROJECT_CONTEXT.md` is referenced by the shortcut rules but does not exist yet.

Next task:
- Create `PROJECT_CONTEXT.md` with the current project architecture, package boundaries, and CAD viewer constraints.
