# Walk Midnight

An independent first-person visitor client for the real Midnight City.
It reads the public live world, not a clone or seeded simulation. Walking moves
only your local camera. It never controls, claims, or speaks as an agent.

The active view now uses Midnight City's actual experimental 3D scene builders,
authored model placements, materials, elevation, water, lighting, and 2D resident
sprites. It no longer fits buildings to approximate rectangles or draws pill agents.

## Run locally

Requires Node.js 22.12+ (Node.js 24+ recommended).

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Production-style local preview:

```sh
npm run build
npm start
```

Open http://127.0.0.1:4173. Both servers default to loopback-only access.
The first development/build run downloads nine pinned public rendering modules.
Their SHA-256 hashes are checked before extracting rendering-only dependencies.
Later runs use `.cache/native/`; generated code remains ignored by Git.

## Controls

- Click **Walk into the city** to capture the mouse.
- WASD walks; Shift runs; mouse looks; Escape releases the mouse.
- Arrow keys look when the world canvas has keyboard focus.
- Look at a nearby resident and press E to inspect.
- Press E near doorways to visit the connected space.
- The map and **Walk nearby** relocate only your visitor camera.
- Select a resident to read their real public conversations and inventory.
- Look at a nearby resource and press E to inspect its observed state.

## Connection and safety

Anonymous, read-only HTTP bootstrap plus spectator WebSocket updates. Sequence
gaps, malformed frames, map-version changes and stale connections trigger a
bounded-backoff resync. No tokens, cookies, local-control calls, mutations,
generated agent replies, or account impersonation. Public text is rendered as
text, never injected HTML. Snapshot data is not committed to this repository.

## Current limits

- **Guest speech is not implemented:** no official anonymous human-to-arbitrary-
  agent chat API was established. The native chat observed in Chrome required
  sign-in. Official profile links retain the site's own authentication boundary.
  The direct-control `speak` action would impersonate/control an agent, and is
  deliberately not used. This is an open requirement, not a working chat claim.
- The experimental scene was authored for an orbit camera. Street-level views
  expose its original low-poly geometry and pixel-art sprites at close range.
  Buildings and props retain their authored proportions; sprite height no longer
  stretches with the original elevated-camera compensation.
- This is a pinned experimental renderer, not a supported integration SDK.
  Upstream asset removal or incompatible map changes can require an update.
- Desktop-first mouse/keyboard controls; no mobile walking controls yet.
- Public source/model access is not a license. Redistribution/public hosting
  permission has not been established. Assets are fetched on demand for local
  development; original source and models are not committed. Obtain permission
  before publishing the native-derived renderer or assets.
- Public spectator endpoints are observed contracts and can change upstream.

See [integration findings](docs/integration.md) for verified routes and sources.

## Verification

Checked locally on 2026-10-03:

- Type checking and production build pass. Vite reports a large Three.js bundle
  warning; bundle splitting remains a performance improvement.
- Collision, boundary handling, portal pairing, event deduplication, and delta
  sequence checks pass targeted assertions.
- Chrome renders original models and live residents; keyboard walking changes
  visitor coordinates, and E follows the Central → Construction Yard doorway.
- Actual public conversation lists and messages load in the resident panel.
- Production server serves the built client and a verified GLB, rejects write
  methods and out-of-root file paths. Guest speech is not verified or enabled.

## Movement and rendering

- Resident sprites replay timestamped samples with a 1.5-tick buffer
  (normally 750 ms). This absorbs network jitter without inventing future moves.
  Turns preserve the received tile path; teleports snap rather than crossing the
  whole map. A stale feed stops at its final received position.
- Native scene geometry and baked-light materials are unchanged. Its cached
  background, instancing, sprite animation and postprocessing remain in use.
- The native 30 FPS cap is removed. Visitor collision comes from visible scene
  geometry, not simulation-only blocked tiles. A compact 5 cm collision raster
  follows walls and props, allows low curbs and overhead arches, and slides along
  edges. Foliage and decorative lettering do not become invisible barriers.
  Native floor height is retained; looking down does not stretch sprites.
- Walking-boundary preparation yields in short slices instead of blocking the
  whole page. Completed surfaces use a 32 MiB least-recently-used cache keyed by
  native geometry revision. Room changes cancel obsolete work; old asset loads
  cannot overwrite newer rooms, including rapid A → B → A switches.
- Hidden resident lists are not sorted on every movement update. HUD work is
  memoized, and repeated model-progress notifications do not rerender the UI.
- Production builds precompress JavaScript/CSS with Brotli and gzip. The local
  production server negotiates compression and caches content-hashed assets;
  HTML stays revalidated. No geometry, texture resolution, lighting, reflections,
  antialiasing or postprocessing quality is reduced.
- React's root survives hot updates; scene effect cleanup disposes the previous
  world connection and renderer.
- `src/native-scene.ts` adapts the native renderer to the independent visitor UI.
  `scripts/sync-native.mjs` isolates it without executing the original app entry,
  account controls, or agent-action APIs. `native-assets.mjs` serves only reviewed
  public artwork paths with method, size and file-signature checks.
- The earlier custom renderer remains in the repository but is not imported by
  the active client.

Opt-in local diagnostics: add `?diagnostics=1`. The world canvas exposes a
`data-performance` attribute with rolling frame timing, draw counts, and scene
coverage. No diagnostics are transmitted. Targeted local reproduction scripts
and measurements live in ignored `artifacts/debug/`, not in the shipped app.
`data-walking` reports the space, collision preparation time, longest measured
work slice, polygon count and cache hit. A work-slice budget is not a frame-rate
guarantee: browser scheduling, garbage collection and GPU work still vary.
