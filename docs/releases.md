# Releases

| Trigger | Result |
|---|---|
| Push to `main` | Check, then deploy Pages Preview |
| Stable `vX.Y.Z` tag | Check, deploy production, publish the exact static artifact and SHA256 to GitHub Release |
| Pull request or manual web-check | Check and retain artifacts; no deployment |
| Bump version | Synchronize version metadata, create the tag, and explicitly call the browser workflow |

```sh
gh workflow run version-bump.yaml --ref main -f bump=patch
```

The tag must match `VERSION` and both web package manifests, and point to a commit contained in `main`. Do not move published tags or silently replace release assets. Docker/GHCR publishing is retired.

## Configuration

- Project: `image-studio`; Pages production branch: `production`.
- Production: https://image-studio.otama-playground.com/
- Preview: https://preview.image-studio-c5u.pages.dev/
- CNAME target: `image-studio-c5u.pages.dev` (including the assigned suffix).
- Secrets: `CLOUDFLARE_API_TOKEN` with account Pages Read/Write; `CLOUDFLARE_ACCOUNT_ID`.
- Variable: `IMAGE_STUDIO_BUILD_INPUT`, pointing to immutable public HF input.

DNS permissions are separate from Pages permissions. R2/S3 keys are not required. Never expose credentials in the browser, source, or build output.

The same run's checked `dist/` and `inventory.json` are verified before deployment and release packaging. Deploy jobs do not rebuild. Keep private-artifact, integrity, license, and 25 MiB guards enabled.

## Recovery

Roll back to a verified **production** deployment and compare commit, sourceId, and inventory. Never attach the public domain to Preview. The first verified baseline is v1.2.0, commit `630bb43a90186c3aa9a1574f84926fb7b84e887e`, deployment `265e3a7b-5573-4f42-b128-e85197ac213e`.

Server rollback does not replace JavaScript or unsaved photos in existing tabs. Check an existing tab's save and a newly opened tab separately; never force reload a tab holding a photo. Reload loses in-memory photos by design. Preserve immutable model/source/license assets and required recovery evidence.
