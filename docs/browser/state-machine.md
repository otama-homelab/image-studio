# State contracts

The app is the product of independent route, input, background, export-slot, transfer, and gate states. Do not flatten them into a global enum or infer ownership from a progress label.

## Invariants

| ID | Contract |
|---|---|
| I01 | SPA route changes retain each editor's photo/settings/files; they do not transfer photos automatically. Reload/pagehide releases in-memory state. |
| I02 | Failed/cancelled candidates retain the previous verified photo until the first visible render succeeds. Already-invalidated save slots need not be resurrected. |
| I03 | Commit requires both the current active token and context `(inputId, inferenceRevision, modelVersion, rgbAssetId, refine)`. |
| I04 | Reuse an HR mask only for the same RGB asset and model. Refinement changes retain it; photo/model changes and close release it. Mask and final-result validity differ. |
| I05 | Late completions/errors after edits, cancellation, or pagehide cannot change the current photo, result, save link, or route. |
| I06 | Cancellation intent is not termination. Keep leases and input pins until termination is confirmed; admit no conflicting heavy work meanwhile. |
| I07 | Unconfirmed termination blocks reuse and requires session recovery. Never report a successful cancellation. |
| I08 | Recheck source key, output options, origin validity, and link ownership at download/transfer time, including before React effects run. |
| I09 | Crop PNG, sheet PNG, and sheet PDF have separate slots. Display-only format switches retain slots; actual dependency changes invalidate affected slots. |
| I10 | Replacing a recipient photo requires consent. Cancellation preserves both editors; adoption rechecks source validity and navigation epoch. |
| I11 | Admit one parent pipeline and one child Worker. A release request does not free the lease while a child lives; stale leases cannot release or block a new owner. |
| I12 | Close synchronously rejects new operations, shares one close Promise, and distinguishes confirmed/unconfirmed termination. A closed flag alone proves no release. |

## Input and transfer

Input: `Empty/Ready → ReplacePrompt → Checking → Decoding → Verifying → Ready`. Skip replacement consent for an empty editor. Failure/cancellation restores the prior verified photo; visible adoption is a separate checkpoint from decoding.

Transfer: `None → Prompt/Importing → Adopted/Rejected → None`. Cancel on consent dismissal or route-epoch change. Validate upstream origins transitively for background → resize → print. Stale downstream previews may remain visible, but cannot be saved or transferred until explicitly refreshed. Independently loaded print photos do not depend on resize edits.

## Background

Lifetime: `Open → Closing → ClosedConfirmed/ClosedUnconfirmed`.
Admission: `Available/Running/Stopping/Blocked`.
Data: `Empty/Photo/Mask/Result`; export slots are independent.

| ID | Event and result |
|---|---|
| B01 | Valid setPhoto increments revision and invalidates old mask/result/export. Invalid input retains current state. |
| B02 | A known changed model retains the photo, updates defaults, and invalidates mask/result/export. Same ID is a no-op. |
| B03 | A supported changed refinement flag retains the mask, invalidates result/export, and increments revision. Same value is a no-op. |
| B04 | Run requires a photo and gate admission; snapshot context/token before work. Rejected admission starts nothing. |
| B05 | A current completion commits only after child resources terminate, then returns to Available. A cutout alone is not a downloadable file. |
| B06 | Stale/cancelled completion cannot commit or cancel a newer job. |
| B07 | Ordinary failure with confirmed termination retains the photo and matching mask, exposes a safe error, and allows explicit retry. |
| B08 | Cancel enters Stopping, invalidates the token, and waits for owned resources. Reject conflicting edits/run/save. |
| B09 | Confirmed termination returns to Available, discards uncommitted output, and retains the photo/matching mask. |
| B10 | Failed termination enters Blocked; do not reuse resources. |
| B11 | Close enters Closing, synchronously rejects work, invalidates the token, stops owned resources, and releases data. |
| B12 | Settled close yields Confirmed/Unconfirmed. Repeated close shares the Promise; failure is not success. |

Run order: HR load/infer/release → optional trimap and Matte load/infer/release → foreground → commit. Reuse a matching mask by skipping HR. Refinement-off skips Matte; lightweight models have no Matte stage. Check cancellation and ownership at every await.

Consent: `NoIntent → Inspecting → Confirmable → Rechecking → Started`. Cancellation, deactivation, or pagehide invalidates intent. Recheck owner/epoch/active/blocked/closed immediately before starting; increased estimates or insufficient storage require confirmation again. Cache inspection never starts inference.

## Export

| ID | Event and result |
|---|---|
| E01 | Generate requires valid source/options/origin and gate admission. Pin input and snapshot the key/options. |
| E02 | Current completion publishes Ready only after validating bytes, MIME, dimensions, and filename. |
| E03 | Changed source/options make the result stale; do not publish it. Await required termination. |
| E04 | Cancel enters Cancelling and retains input pins/admission until termination. |
| E05 | Confirmed cancellation returns to Idle; late files cannot appear. |
| E06 | Failed termination blocks reuse without indiscriminately deleting other valid slots. |
| E07 | Dependency changes invalidate the affected Ready slot and remove its link; display-only switches retain it. |
| E08 | Download/transfer re-evaluates the predicate immediately; reject stale output and request regeneration. |

`canSave = readyFile && sameSourceKey && sameOutputOptions && originCurrent && linkOwned`, plus the operation's busy/blocked/closed guards. Background color changes do not change transparent PNG bytes, but invalidate a color-dependent handoff origin.

## Proof

UI tests cover input rollback/transfer; background-session and inference-operation tests cover ownership/cancellation/close; export tests cover pins, slots, and immediate invalidation; gate tests cover parent/child leases. A passing mock Promise or one successful journey does not prove physical Worker termination, every event ordering, device compatibility, or general image quality.
