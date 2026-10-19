# P2-005 A-spike: isolated preview prototype

Dev-only feasibility prototype. **Not part of the plugin package and not wired into
the Host/Client.** It answers whether a controlled project snapshot can play and
seek inside a sandboxed cross-origin iframe using the fixed HyperFrames runtime.

## Pinned inputs

- `@hyperframes/core` **0.8.167** (runtime IIFE shipped in that package)
- `puppeteer-core` **25.14.0** for the real-Chrome evidence runner
- Controlled fixture: a `demo` project directory with `index.html`,
  `project.json`, GSAP/MotionPath assets and the local Heiti font. The prototype
  serves **only** the entry and declared assets from that directory; it is not a
  general file server and is not the product snapshot API.
- Chrome used for evidence: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
  (`155.0.8059.79` at capture time).

`node_modules/` is ignored. The lockfile is committed.

## Reproduce

```sh
cd experiments/preview
npm ci --ignore-scripts
node run.mjs \
  --fixture /absolute/controlled/project/demo \
  --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# same-revision worker frames for consistency comparison
node worker-frames.mjs --staging /absolute/clean/staging --out "$PWD/evidence"
node compare-frames.mjs "$PWD/evidence"
```

`run.mjs` starts a loopback-only server, loads the parent page and sandboxed iframe,
waits for the HyperFrames runtime, then puts Chrome offline before seeking to
0.5/2.5/4.5s, playing briefly and pausing. It records `evidence/offline-seek.json`
plus iframe screenshots and fails if an external request is attempted.

The prototype's parent page uses `sandbox="allow-scripts"` (no
`allow-same-origin`), a CSP with `connect-src 'none'`, and the runtime's narrow
`postMessage` bridge (`{source:'hf-parent', type:'control', action:'seek'|'play'|'pause'}`).
It does not establish a security boundary against browser/renderer exploits; it
only demonstrates opaque-origin isolation and offline playback/seek for a
controlled snapshot.

See `../../docs/research/P2-005-preview-spike.md` for conclusions and the
production proposal.
