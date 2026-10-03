# Integration findings — 2026-10-03

## Product boundary

The visitor is the human, not an existing simulation agent. Never claim a control
lease, impersonate an agent, interrupt hosted AI, or send agent actions. No account
cookies, API tokens, or credentials are extracted from Chrome.

## Verified public connection

- `https://www.midnight.city/observer/api/spectator/bootstrap` returns live
  `dynamicWorld`, `recentEvents`, `sequence`, and `staticVersion` without login.
- `/observer/api/static-world/{staticVersion}` returns `staticWorld`, containing
  spaces, tile traversability, areas, and paired teleports. Both HTTP endpoints
  returned `Access-Control-Allow-Origin: *` to a localhost-origin request.
- `wss://www.midnight.city/observer/ws` emits `snapshot` and `spectator_delta`.
  A snapshot contains dynamicWorld; deltas contain sequence bounds and a batch.
- The public web client loads GLB models from `/models/city-neon/`. These assets
  do not advertise cross-origin browser access, so the local server forwards
  allowlisted artwork GET/HEAD requests. The active client extracts native
  rendering code, but never executes the original application entry point.
  Third-party code and models remain their owners' assets; public hosting and
  redistribution permissions have not been established.

## Visitor interactions

Chrome showed agent inspection (name, status, location, inventory), public
conversations, room visits, an owner-agent chat, and Nyx chat. The inspected
session was signed out. Both chat surfaces required sign-in. The official
direct-control API's speech actions act as a simulation agent, so they do NOT
meet this project's independent-visitor requirement.

No supported anonymous human-to-arbitrary-agent speech API has been established.
Do not invent guest speech, fabricate replies, or route visitor chat through an
agent-control endpoint. Keep this requirement open until an official visitor
chat integration is available. Official-site links preserve its own sign-in
and authorization boundaries.

## References

- https://www.midnight.city/city/neon?space=central
- https://www.midnight.city/docs/connect-to-midnight-city/
- https://www.midnight.city/docs/connect-to-midnight-city/hermes-openclaw/
- https://www.midnight.city/docs/gameplay/world-navigation-and-events/

These are observed integration contracts, not a stability promise. Validate
responses, discard incompatible deltas, reconnect with backoff, display stale
state, and never substitute fabricated agents when the service is unavailable.

## Earlier rendering corrections

The original implementation discarded non-agent arrays when applying its first
delta. Preserve `resourceNodes`, `npcs`, `enemies`, `merchantOutlets`, construction
metadata, and `tickRateMs`; merge the corresponding update/removal lists. NPC
updates are keyed by name; resource and enemy updates are keyed by id.

Observed city ticks are 500 ms. Render movement on a buffered server-time
timeline rather than repeatedly easing toward the newest tile, which produces
a burst-and-stop on each update. Stationary samples matter at path endpoints.

The public Neon client asset `NeonCityPage-BPSPbVZP.js` provides Central's extra
building layout metadata, model catalog, courtyard placements, and GLB color
semantics. `src/scenery.ts` records the relevant observed placements and uses
independent rendering code. Its additional building layout is restricted to the
observed 144×114 Central map. Prop centers are checked against blocked tiles and
building coverage; decoration does not modify the authoritative walking grid.

GLB four-component vertex colors are not ordinary paint: RGB is baked light and
alpha is ambient occlusion. Treating RGB as a base-color multiplier made foliage
and other assets almost black. Keep the alpha channel and decode it in the model
material. Live resources and creatures use lightweight representative geometry,
not copied simulation behavior.

Local checks after the corrections rendered 46 Central building footprints,
166 scenery placements, and 94 live objects in the captured snapshot. Counts of
residents and available creatures vary with the actual city. Chrome frame-time
samples improved from an initial 75 ms p95 to approximately 9–17 ms after the
rendering changes, despite the added scenery. These are local observations, not
a cross-device performance guarantee.

## Native experimental scene adaptation

The subsequent user request replaces the approximation with the actual scene.
`scripts/sync-native.mjs` parses the pinned public ES modules, follows lexical
references from the native renderer, and emits only its dependency closure.
All nine source hashes are pinned in `scripts/native-sources.json`. Downloaded
source, generated modules, and artwork remain excluded from Git.

Central and other-space scene builders (`Er`, `xr`, `yr`) are byte-for-byte
unchanged. Original geometry, transforms, surface materials, lighting, floor
height, water, workstation art and construction-yard model loading are retained.
The React application, auth, control APIs and native workstation inspector are
not included. The small retained main-bundle subset is appearance data and pure
appearance helpers, not the app startup. Public artwork is served through a
fixed-origin, read-only, file-signature-validated adapter.

The walking adapter disables orbit/pan/follow controls, sets a 72-degree view and
1.75-unit eye height above native ground, and adds independent mouse/keyboard
walking. The 30 FPS renderer cap is removed. Sprite tilt compensation is disabled
so looking down cannot elongate residents. Their original appearance seeds and
character sheets are preserved. Native sprite interpolation uses server-time
samples and the jitter-buffered playback clock rather than packet arrival time.

The old custom renderer remains available as source history but is not active.
No simulation writes or agent-control requests are added.

## Visitor collision correction

Simulation traversability is not the visitor's collision map: authored props and
streets do not always fill the simulation's blocked tile regions. The visitor now
uses a spatial raster built from visible mesh triangles, including instanced
transforms, clipped to the body-height band. Collision resolution is 0.05 world
units with a 0.17-unit visitor radius. Low curbs, overhead arches, foliage and
decorative text do not block open paths. Swept movement prevents tunneling and
slides along walls. Visible water blocks walking except below elevated native
ground. Map relocation uses the same collision surface. The simulation agents
continue to follow their own authoritative rules, entirely independently.

Targeted checks cover thin walls, wall sliding, overhead arches, curbs, instanced
trunks, boundaries, water and relocation. Collision generation is once per scene,
not per frame. Earlier tile-collision assertions apply only to the retained old
renderer and must not be cited as coverage for this native walking adapter.

## Charging House first-person rendering

The native Charging House deliberately disables depth writes on its furniture
and draws material layers in a fixed order for the overhead view. From eye level,
this paints distant beds over nearby furniture. `prepareFirstPersonMaterials`
restores depth testing/writes for opaque furnishings and removes that layer order,
while preserving planar rugs and transparent surfaces.

The blanket skirts also intersect their mattresses in the source models, hidden
by the overhead drawing rule. First-person preparation expands the blanket's top
panel over the mattress before it drapes down; the original outer dimensions and
cached source geometry remain unchanged. This operates on a per-scene geometry
copy and is idempotent. Checks use the actual native room builder and downloaded
bed models, verify every bed variant, preserve transparency, and confirm source
assets are unmodified. Chrome confirms normal furniture occlusion at eye level.

## Quality-preserving optimization

The collision raster algorithm now runs as a resumable generator. The production
adapter yields after a nominal 6 ms budget, with checkpoints inside triangle
processing and large raster spans. Scene changes/disposal abort unfinished work.
The synchronous entry point remains available for differential checks. On a
384,000-polygon instanced fixture, event-loop blocking fell from 234 ms to 7.5 ms;
the resulting collision bytes are identical. Cooperative scheduling may increase
first-load elapsed time while keeping the interface responsive.

Chrome measured Central's original synchronous preparation at 1,513 ms. After
the change, one run's longest work slice was 10.6 ms; a separate run reached 53 ms
under contention. Reentering unchanged Central reused its surface in 0.1 ms.
The 32 MiB LRU key comes directly from the native geometry revision, not merely
the space name; failed artwork loads are not cached as valid walking surfaces.

Native room loads now carry monotonically increasing request generations. This
prevents an old A load from appearing current after A → B → A navigation, and
guards completion after asynchronous collision preparation. A controlled replay
fails without the generation checks and passes with them.

The resident panel skips hidden sorting, memoizes space membership/events, and
ignores duplicate asset-progress state. Production delivery serves prebuilt
Brotli/gzip alternatives with content-hashed immutable caching and revalidated
HTML. The measured JavaScript transfer is 331,239 bytes instead of 1,342,137;
decompression produces the identical original bytes. Negotiation, HEAD responses,
uncompressed fallback, cache behavior and exact contents pass local checks.

The native scene builders, background/postprocessing pass and reflection pass
remain byte-identical to the pinned originals. No adaptive resolution or detail
reduction was added. Existing walking, motion and actual Charging House model
checks pass. These measurements establish reduced loading stalls and download
size, not a controlled before/after walking-FPS improvement.
