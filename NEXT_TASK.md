# Next Task

Browser-smoke actual CAD parsing on deployed or production-preview output.

Recommended first implementation task:
- Hard-refresh `http://127.0.0.1:5175/` or `http://localhost:5175/` and retry local DXF upload after the worker URL resolver fix.
- Open the production preview or Vercel deployment and smoke-test loading one predefined DXF and one predefined DWG in a desktop viewport.
- Upload `packages/cad-viewer-example/e2e/fixtures/minimal-line.dxf` through the simple app file input.
- Repeat the same smoke test in a mobile viewport or physical mobile browser.
- Check console/network for worker MIME errors, worker 404s, CORS failures, parser errors, range errors, and memory crashes.
- Confirm failed loads keep the empty state available and show a clear error for unsupported, empty, oversized, or renamed files.

Known fixed issue to watch for regressions:
- Worker URLs must resolve to `/workers/<worker-file>.js`, not `/src/undefined`. Do not reintroduce dynamic `new URL(..., import.meta.url)` worker path construction for these copied CAD worker files.

Files to inspect first:
- `PROJECT_CONTEXT.md`
- `packages/cad-simple-viewer-example/src/main.ts`
- `packages/cad-simple-viewer-example/vite.config.ts`
- `vercel.json`
- `package.json`

Avoid for target app work:
- `packages/cad-viewer`
- `packages/cad-viewer-example`
- `MlCadViewer`
- Vue components/composables
