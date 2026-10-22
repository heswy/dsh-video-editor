# Upper video track priority

User requested immediate correction on 2026-10-22. Base origin/main `a9f460c`; branch `codex/upper-track-priority` in the existing isolated worktree.

Root cause: composition CSS z-index increased with the timeline's array index, so lower visual tracks covered upper tracks. Reverse visual z-index only; preserve stored track order, IDs and data-track-index. Transition overlays use the same corrected layer as their track. Preview snapshots, frame capture and MP4 rendering share this composition generator. No project migration or content rewrite.

Regression first failed on the old generator. New test verifies upper > lower, transition layer consistency and stable track index. A disposable real-worker project uses red on the upper track and blue below: actual frame RGB [255,0,0], hiding upper reveals [0,0,255], H264 export center pixel [252,0,0]. Script `scripts/test-v1-track-stacking.mjs` supports the fixed staging worker too. Installation results follow after execution.
