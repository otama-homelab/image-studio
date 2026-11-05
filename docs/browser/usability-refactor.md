# Photo-first layout redesign — 2026-11-05

The user requested a whole-app Hallmark redesign, less text, repaired layouts, and Tailwind / Node library reuse.

## Decisions

- Preserve the existing logo, neutral palette and system font. Keep all four hash routes and existing image/session/worker ownership.
- Use Tailwind CSS and its official Vite plugin, both 4.3.4 / MIT, fixed in the lockfile. The plugin compiles static CSS; no CSS CDN or runtime service. Include Tailwind in shipped notices.
- Each screen owns its responsive grid in JSX. Remove competing global main/grid-row/grid-column rules. Share workflow navigation through native hash links and aria-current.
- Place photo selection before model/cache details. Use native disclosure for secondary explanations, print instructions and input/environment limits. Preserve execution consent, errors, recovery and CPU HR warnings.
- Retain React, react-easy-crop, pdf-lib and native details/dialog. No new tabs state machine or overlay engine is needed.
- HR is PC-only by product decision: filter variants before constructing model lists, cache scopes and sessions. Identify mobile via UA-CH / phone-tablet UA / iPad desktop-mode signals; narrow desktop windows and touch Windows PCs retain HR. Lightweight mobile CPU remains the default. Research mobile models after release.

## Evidence and verification

User evidence: difficult layout, too much text, iPhone HR GPU runtime-error during background inference, and CPU page refresh. The root causes of the phone failures remain unproven.

Public UX references inspected over HTTP: [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) and [remove.bg](https://www.remove.bg/). Adobe Express and Tailwind docs returned HTTP errors; fixed package metadata, installed plugin and real Vite builds confirmed the integration. No interviews or interaction metrics were invented.

Web suite: 330/330 passed; added shared-navigation suite: 4/4 passed. Final disclosure / label changes: focused 139/139 passed. Build/distribution guard suite: 26/26 passed. Public model-enabled build and Pages artifact checks passed. An earlier concurrent run timed out in three tests; a subsequent serial run passed without extending timeouts or weakening assertions.

Hallmark rendered all four routes at desktop and phone widths. Final sweep: 0 Floor failures, 0 Reflex findings; one primary-recipe Finish warning answered: photo upload becomes secondary after a photo exists, while processing is disabled before selection. Native closed-disclosure contents are explicitly hidden; compact license-link copy retains its accessible name. In-thread finish review covered initial layouts, navigation alignment, phone wrapping and disclosure placement. Local screenshots are kept under ignored .hallmark, outside the published app.

These screenshots cover empty/initial states, not fresh model inference or real iPhone acceptance. Existing DOM tests cover populated editor/export/recovery states. Preview review remains distinct from production release and physical-print acceptance. No model inference or infrastructure changes were performed for this redesign.
