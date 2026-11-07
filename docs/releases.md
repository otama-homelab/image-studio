# Releases

| Trigger | Result |
|---|---|
| Push to `main` | Check, then deploy Pages Preview |
| Stable `vX.Y.Z` tag | Check, deploy production, publish the exact static artifact and SHA256 to GitHub Release |
| Pull request or manual web-check | Check and retain artifacts; no deployment |

Change `VERSION`, `web/package.json`, and both root version fields in `web/package-lock.json` together in a pull request. After CI and merge, an administrator may create the matching stable tag on that main commit. The build rejects mismatched versions. There is no workflow that writes main or creates tags automatically.

Main requires a PR and the trusted `web` CI check. Tags are administrator-created and cannot be changed/deleted through normal Git operations. Preview/production deployments require environment approval; Cloudflare credentials exist only in those environments. Production accepts `v*` tags, Preview accepts `main`. Release artifacts are uploaded to a draft, then published immutably. Existing tags/assets are not replaced. Docker/GHCR publishing is retired.

## Configuration

- Project: `image-studio`; Pages production branch: `production`.
- Production: https://image-studio.otama-playground.com/
- Preview: https://preview.image-studio-c5u.pages.dev/
- CNAME target: `image-studio-c5u.pages.dev` (including the assigned suffix).
- Environment secrets: `CLOUDFLARE_API_TOKEN` with account Pages Read/Write; `CLOUDFLARE_ACCOUNT_ID`.
- Variable: `IMAGE_STUDIO_BUILD_INPUT`, pointing to immutable public HF input.

DNS permissions are separate from Pages permissions. R2/S3 keys are not required. Never expose credentials in the browser, source, or build output.

The same run's checked `dist/` and `inventory.json` are verified before deployment and release packaging. Deploy jobs do not rebuild. Keep private-artifact, integrity, license, and 25 MiB guards enabled.

## Recovery

Roll back to a verified **production** deployment and compare commit, sourceId, and inventory. Never attach the public domain to Preview. The first verified baseline is v1.2.0, commit `630bb43a90186c3aa9a1574f84926fb7b84e887e`, deployment `265e3a7b-5573-4f42-b128-e85197ac213e`.

Server rollback does not replace JavaScript or unsaved photos in existing tabs. Check an existing tab's save and a newly opened tab separately; never force reload a tab holding a photo. Reload loses in-memory photos by design. Preserve immutable model/source/license assets and required recovery evidence.

## RVM portrait option (1.2.5)

MODNet remains the default. The optional RVM CPU adapter runs an independent
low-resolution still-image alpha graph and restores alpha with the upstream scalar
Fast Guided Filter. It does not expose RVM video tracking or foreground-color
prediction. Both graphs use the existing verified archive/cache and PNG adapter.

The [immutable model bundle](https://huggingface.co/otama3/image-studio-models/tree/8297d842590ffab4333007690c28da13f73084d4/models/rvm-alpha-fgf-e75bfaf9-82cd26c5-v1)
includes GPL-3.0, corresponding source and conversion changes. The application
license remains separate. The model card records the unresolved upstream question
about a separate pretrained-weight license; no permissive weight grant is inferred.
Mobile memory fit and broad real-photo quality are not claimed.
