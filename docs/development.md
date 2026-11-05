# Development

Use `web/.node-version` and locked dependencies. No Python server, Docker image, or external image-processing API runs the app.

```sh
cd web
npm ci --ignore-scripts
npm run dev
npm test
npm run test:scripts
npm run test:domain
npm run build
```

The dev server binds to loopback. UI, build/distribution, and shared Worker/state tests are separate; passing them does not establish device compatibility or general image quality.

## Ownership

| Module | Responsibility |
|---|---|
| `web/src/Root.tsx` | Routes and explicit photo transfers |
| `web/src/background/` | Background editor and session ownership |
| `web/src/App.tsx`, `CropViewport.tsx` | Resize/print UI and framing |
| `tools/browser-library-adapter/` | Shared image, inference, export, resource, and cancellation contracts |
| `web/scripts/`, `tools/build_browser_*` | Checked static build and immutable model input |
| `tools/browser-build/` | Locked Worker build dependencies |
| `tests/`, `web/tests/` | Contract and UI regression tests |

[State contracts](browser/state-machine.md) define cancellation, photo adoption, stale results, and saving. Keep those decisions in their owning modules, not in individual buttons.

## Model builds

CI prepares `web/background-release/` from `IMAGE_STUDIO_BUILD_INPUT`, checks hashes, and builds Workers using `tools/browser-build/`. Invalid input fails the build; it does not silently produce a background-free release. Local builds without this generated directory support manual resize/print only.

Python model conversion, native reference generation, and WASM build tools are development-only. Keep their outputs and private photos outside the source tree. Retain model/runtime notices and pinned fixtures in `docs/browser/`; do not rewrite license texts or remove data consumed by build guards. Historical investigation notes are not required to build or use the app.
