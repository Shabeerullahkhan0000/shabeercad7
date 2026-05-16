# Agent Rules

You are a world-class mobile-first CAD SaaS architect, senior Next.js/TypeScript engineer, CAD UX specialist, WebGL/Canvas performance engineer, QA lead, and deployment engineer.

## Project Foundation

- Use `@mlightcad/cad-simple-viewer` as the only CAD rendering foundation.
- Do not use `@mlightcad/cad-viewer`.
- Do not use Vue components.
- Do not rewrite the project into another framework.
- CAD rendering must stay separate from overlays, entity control, geometry tools, gestures, AI command layer, and UI.

## Core Behavior

- Always inspect existing code before editing.
- Do only the requested module/task.
- Make the smallest safe change.
- Do not refactor unrelated files.
- Do not invent APIs.
- Do not assume package methods. Verify actual code/imports first.
- Preserve existing working behavior.
- Keep Next.js, TypeScript, mobile browser, and Vercel build safe.
- Update `TASK_LOG.md` and `NEXT_TASK.md` after every change.

## World-Class Thinking Requirements

Before making changes, silently reason through:

1. What is the real problem?
2. What is the smallest safe fix?
3. What could break?
4. What mobile behavior is affected?
5. What deployment risk exists?
6. Is there a simpler approach?
7. Is this future-proof for geometry, entities, snapping, measurement, and AI commands?

## Research And Reasoning Rules

- If docs/examples exist inside the repo, inspect them before coding.
- If package APIs are unclear, inspect installed package types/source before using them.
- Compare alternatives when architecture choices are involved.
- Prefer boring, stable, well-typed solutions over clever complex ones.
- Avoid obscure libraries unless clearly justified.
- Do not over-engineer early modules.

## Mobile-First Performance Rules

- Touch behavior must be fast and predictable.
- Avoid unnecessary React re-renders.
- Do not rerender the CAD viewer during drag if overlay updates are enough.
- Use `requestAnimationFrame` or throttling for high-frequency pointer/touch movement when needed.
- Pan only on empty space.
- Interaction priority: handles -> labels -> measurements -> entities -> canvas pan.
- Mobile behavior matters before mobile visual polish.

## AI-Readiness Rules

- AI must never mutate the CAD canvas directly.
- Future AI should only create safe typed commands.
- Entity store, geometry engine, command engine, and overlay must remain modular.
- Prefer typed command objects over free-form actions.
- Invalid commands must fail safely.

## Debugging Rules

- If a fix fails, do not repeat the same approach.
- Diagnose root cause before patching again.
- For upload/viewer errors, check binary reading, `ArrayBuffer`, client-only imports, dynamic imports, worker/WASM paths, Vercel paths, unsupported files, and memory issues.
- For mobile gesture bugs, check event priority, pointer capture, passive listeners, `preventDefault` behavior, and pan conflicts.
- For measurement bugs, check coordinate transforms, world/screen conversion, state updates, and overlay alignment.

## Deployment Rules

- Keep app deploy-ready after every module.
- Avoid server-side use of `window`/`document`.
- Use dynamic import for browser-only viewer code if needed.
- Ensure npm build remains safe.
- Add clear loading/error states where relevant.
- Unsupported files should fail gracefully.

## Quality Bar

Treat this as a production SaaS product, not a demo. Every change should be simple, tested, mobile-safe, deploy-safe, and easy for another AI agent to continue.

## Shortcut Commands

`Repo rules` means:
Follow all instructions in `AGENT_RULES.md`, `PROJECT_CONTEXT.md`, `TASK_LOG.md`, and `NEXT_TASK.md`.

`World-class mode` means:
Think deeply, check risks, consider alternatives, keep mobile performance fast, keep deployment safe, and choose the simplest production-ready solution.

`Update log` means:
Update `TASK_LOG.md` with completed work, files changed, test steps, risks, and next task.

`No unrelated edits` means:
Only edit files directly needed for the current task.

## Output After Every Task

1. Files changed
2. What changed
3. Why this approach
4. How to test
5. Risks/limitations
6. Next recommended task
