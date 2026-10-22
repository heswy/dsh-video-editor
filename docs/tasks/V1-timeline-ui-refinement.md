# V1 timeline UI refinement and disk cleanup

Requested 2026-10-22: reduce project disk use, simplify the timeline and relocate the media entry. Branch `codex/timeline-ui-refinement` starts at `c258265`, including the live recovery fixes and origin/main `8732906`. User projects remain unchanged.

## Reference and implementation

- [CapCut desktop guide](https://www.capcut.com/resource/how-to-use-capcut-on-pc): resource import, preview, transport and timeline have separate roles.
- [OpenChatCut official workspace](https://openchatcut.com/) and [repository](https://github.com/0xsline/OpenChatCut): resources, conversation and multitrack timeline remain distinct. No third-party source or assets copied.
- Media and audio generation now live in a resource shelf above the preview. The transport contains only playback, progress and time.
- Timeline defaults to fitting its container, with manual zoom and an explicit fit control. ResizeObserver updates presentation dimensions; ruler labels adapt to scale.
- Clip parameters and reference tokens open deliberately from a settings disclosure; Escape closes it and restores focus. Recent change details and targeted undo live behind a history disclosure. Conflict/retry and error feedback remain visible.
- Restrained blue/green clips, consistent track spacing, quieter media tiles, host typography and theme tokens. No added dependencies or font files.

## Cleanup

Private report: `artifacts/cleanup-20261022/report.json`. Archived 42 inactive staging directories in a content-deduplicated standard tar.gz. All 4518 archived files verified by SHA-256 before removal. Reinstallable node_modules omitted; inactive v1-cr-regression dependencies removed. Archive: 72,693,075 bytes. Kept source, branches, current development dependencies, user projects, original evidence, installed alpha.8, rollback alpha.7 and legacy alpha.11 migration entry. Reclaimed 4,419,162,112 bytes (4.12 GiB). Restore instructions are beside the archive. This explicit cleanup request supersedes historical retention of every expanded staging directory.

## Validation

Browser regression first failed because media still lived in the transport. Source Chrome workspace then passed 41 checks including split, drag, trim, audio adjustments, conflict queue, asset insertion and 22s/660-frame export with audio. Added checks cover resource placement, no idle hint footer, collapsed clip settings, Escape, 340px fit and popup bounds. This is component/browser evidence, not an assertion about the native host.

Candidate: bundle 1.0.0-alpha.9 / engine 0.8.2; UI changes inherit the alpha.8 engine. Fixed staging, installation and native verification will be recorded after execution.
