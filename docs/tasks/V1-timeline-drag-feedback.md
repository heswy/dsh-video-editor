# Timeline lifted drag feedback

User reported 2026-10-22 that vertical dragging had no feedback until release. Branch `codex/timeline-drag-feedback`, base origin/main `e5ed689`. Existing isolated worktree reused; no user project changes.

Root cause: clip presentation used translateX only; the destination lane was calculated only on pointerUp. Drag state now includes pointer X/Y, a movement threshold, candidate track, snapped frame and landing validity. A lifted clip follows the pointer with an outline/shadow, the original location keeps a dashed placeholder, and the target lane and snapped footprint show the landing position before release. Overlapping cross-track clips, incompatible/locked tracks and outside-lane drops are rejected. Same-track reorder and trim behavior remain.

No writes during pointer movement. Release performs the existing revision-checked operation once. Escape, pointer cancellation, lost capture, window blur and revision changes clear the gesture. Escape is listened for only during an active pointer gesture so it still works if rerendering loses element focus.

Red: real Chrome held-cross-track check failed because the clip did not move vertically. Green: complete source workspace 45 checks including held geometry, target highlight, source placeholder, snapped footprint, no pre-release write, successful drop/undo, overlap rejection, Escape cancellation and outside-lane release. Audio/collaboration/export regressions remain included (22s/660 frames with audio). Native DSH verification and fixed-candidate installation are recorded after execution; source browser checks are not native host evidence.
