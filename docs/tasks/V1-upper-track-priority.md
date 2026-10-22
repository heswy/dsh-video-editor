# Upper video track priority

User requested immediate correction on 2026-10-22. Base origin/main `a9f460c`; branch `codex/upper-track-priority` in the existing isolated worktree.

Root cause: composition CSS z-index increased with the timeline's array index, so lower visual tracks covered upper tracks. Reverse visual z-index only; preserve stored track order, IDs and data-track-index. Transition overlays use the same corrected layer as their track. Preview snapshots, frame capture and MP4 rendering share this composition generator. No project migration or content rewrite.

Regression first failed on the old generator. New test verifies upper > lower, transition layer consistency and stable track index. Source and fixed-candidate disposable real-worker projects use red on the upper track and blue below: actual frame RGB [255,0,0], hiding upper reveals [0,0,255], H264 export center pixel [252,0,0]. Script `scripts/test-v1-track-stacking.mjs` supports the fixed staging worker too. Source gates 58/86/71, worker 79, client 22 passed (one optional test skipped), version admission 10 passed.

Fixed runtime/root/engine `0381bf0`, clean, bundle 1.0.0-alpha.11 / engine 0.8.3. Staging `artifacts/p2-b/staging-v1.0.0-alpha.11-upper-track`; INTEGRITY SHA256 `35c4c78577fcee6ded26f21180ea804bee350b47d99766c5cef65363dc448041`. Private evidence: `artifacts/v1/evidence/upper-track-20261022/`.

Official Plugin Manager installed and enabled alpha.11 (application=applied, warnings=[]); alpha.10 retained for rollback. Reopened the real DSH browser workspace and waited for its preview ready state: actual rendered elements report track index 0 => z-index 2, track index 1 => z-index 1. Thus the fresh preview uses corrected layering without requiring a new Client. No model request, user content rewrite or public release.
