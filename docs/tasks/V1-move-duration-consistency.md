# Move and duration consistency

2026-10-23 user requests: fix both screenshot cross-track moves and make film duration follow the last clip end. Base origin/main `c6f601d`; branch `codex/timeline-move-consistency`; existing isolated worktree reused.

## Findings

The actual Test timeline had fixed duration 600 frames, a 532-frame clip on the first track and a 68-frame clip on the second. Dropping the short clip at frame 540 exceeded the fixed film by 8 frames; moving the long clip to frame 159 exceeded it by 91 frames. UI preview did not enforce that policy. Same-track overlap also silently invoked whole-track reorder rather than the displayed landing. Snapping matched only the moving start and chose the first candidate rather than the nearest. Pointer coordinates ignored scrolling. Capturing on the moving clip could lose the final pointer event when transient siblings changed.

## Changes

- Shared pure move planner used by pointer preview/release, HTML clip drop and track selector. Preserve source offset, length, speed, asset and other clips. Reject collisions before release; explicit reorder remains in the menu.
- Product policy in PRODUCT.md: normalize legacy fixed padding to automatic duration through a revision-checked, undoable operation on opening. All UI mutations retain automatic bounds. Existing generic Tool fixed-mode support remains; model context instructs automatic duration.
- Match both clip ends against the nearest valid boundary within 6px, with a visible guide. Freeze gesture scale/playhead, incorporate scroll displacement, support horizontal/vertical edge scrolling and temporary tail space.
- Capture pointers on the stable timeline section, not the moving clip. Cancellation/escape/revision safety preserved. Test renderer now handles lostpointercapture explicitly.

## Verification before staging

- Planner regression first failed without a planner; 16 checks now exercise the screenshot coordinates, worker acceptance of generated ops, collisions, endpoint snapping, locks/kinds, negative bounds, no mutation and automatic shrink/delete/audio bounds.
- Chrome workspace 52 checks: legacy 22s padding normalizes to 20s; exact 532/68-frame shape reproduces both requested moves, undo, source metadata preservation, free same-track move, clamping, endpoint snap and held-edge scrolling. Full audio/collaboration/export coverage retained.
- Actual worker export of the screenshot shape after auto normalization is exactly 532 H264 frames / 17.733333s, rather than 600 frames / 20s.
- Source gates 58/86/71; model context 8 checks, 3979 characters. Fixed candidate and native installation results follow after execution. Browser harness evidence is not native acceptance.

## Fixed candidate and installation

Bundle 1.0.0-alpha.12 / engine 0.8.3, clean root=engine runtime `f10e7ffe001e3a62c03852fdd0365bb90b18c4d5`. Fixed directory `artifacts/p2-b/staging-v1.0.0-alpha.12-move-duration`; INTEGRITY SHA256 `44c7ad251f15822b02f4ba7646d6ab20f6bccbd5d6d1caac454be78292f4b061`. Fixed Chrome workspace 52 and actual worker H264 export 532 frames / 17.733333s passed; version admission 10 passed. Evidence is under sibling worktrees `artifacts/v1/evidence/move-duration-20261023/`.

Official Plugin Manager installed and enabled alpha.12 (applied, warnings=[]), retaining alpha.11 rollback. DSH was quit through its menu and relaunched. Opening the real Test project normalized duration from fixed 600 to automatic 532 frames through the normal revision/history path; tracks, clips and assets compared unchanged. Fresh authenticated DSH browser UI confirmed canvas ready and `0.00 / 17.73`; screenshot `actual-alpha12.png`. Native capture intermittently failed with ScreenCaptureKit -3811, so the browser verification is not represented as native gesture acceptance. No real model request was made; model evidence is the 8-check contract only. No public release.
