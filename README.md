# Image Studio

**[Open Image Studio](https://image-studio.otama-playground.com/)**

Remove photo backgrounds, resize to physical dimensions, and arrange print-ready sheets. Processing stays in your browser; photos are not uploaded.

- **Background:** transparent or colored PNG, with optional edge refinement.
- **Resize:** presets or custom dimensions, zoom/pan, and 300 dpi PNG.
- **Print:** A4, L, 2L, or postcard layouts saved as PNG/PDF.

English is the default; Japanese is available. High-quality HR models are desktop-only. CPU HR processing can be extremely slow and memory intensive. Photos and settings stay in memory and are lost on reload or leaving the page. Initial model downloads need a connection.

## Develop

Use the Node version in [web/.node-version](web/.node-version).

```sh
cd web
npm ci --ignore-scripts
npm run dev
```

[Development](docs/development.md) · [Releases](docs/releases.md) · [State contracts](docs/browser/state-machine.md)

`web/` is the static app. `tools/` contains shared image-processing modules and build/reference tools; it is not a server runtime. `main` deploys to Preview; stable tags deploy to production. The Python/Gradio server and Docker/GHCR publishing have been retired.

## License

App code: [MIT](LICENSE). Dependencies, models, and assets retain their own licenses and notices, linked in the app. Models are served from immutable revisions of [otama3/image-studio-models](https://huggingface.co/otama3/image-studio-models). Check the receiving authority's rules for submitted photographs.
