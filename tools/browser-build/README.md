# Browser Worker build dependencies

Install the locked build tools from the repository root:

```sh
npm ci --prefix tools/browser-build --ignore-scripts
```

Pass `tools/browser-build` as the dependency directory to
`build_browser_model_prepare.mjs` and `build_browser_public_stage_worker.mjs`.
Both builders use the official browser bundles of Transformers.js4.3.2,
ONNX Runtime Web1.31.1 and hash-wasm4.12.0 with esbuild0.25.12.
They check the installed versions and existing captured bundle/license hashes.
The Transformers Node entrypoint is only resolved to locate its browser file;
it is not executed. npm install scripts remain disabled.

This build project is separate from the web application's runtime dependency
bundle. Existing captured evaluation directories remain supported for replaying
older source/build evidence. Model policies, resize WASM and approved static
processor/runtime assets are still explicit build inputs; installing these tools
alone does not assemble or approve a public release.
