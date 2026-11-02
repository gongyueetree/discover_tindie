# Local validation — 2026-10-28

Story: a public visitor browses parts/projects through the Tindie API adapter, opens engineering files locally, reviews a deterministic BOM match, and exports a manual PCB placement.

| Boundary | Result | Evidence |
|---|---|---|
| Landing page | Verified in browser | Turquoise/white hero, five tool navigation links, retained Discover section |
| Eagle local ZIP → parsed geometry → SVG | Verified in browser and Node | 1 schematic, 1 PCB, 2 components, 5 pads, curved copper represented by 9 segments |
| KiCad local ZIP → geometry | Verified in Node | 1 schematic, 1 board, 2 components |
| API handler → eelib parts → normalized Part | Verified live in Node | AD9102: 2 variants, CAD links returned |
| API handler → CircuitAtlas | Verified live in Node | 16,092 projects, 24 entries on first page |
| API handler → parsed public project | Verified live in Node | Project MkI, 1 PCB returned |
| BOM match handler → catalogue | Verified live in Node | AD9102BCPZ exact match; full suffix preserved |
| Pricing handler → eelib suppliers | Verified live in Node | 1 DigiKey offer; Mouser explicitly reports not_carried |
| BOM rule/estimate behavior | Automated checks pass | Full MPN vs suffix mismatch, ambiguous specifications, unknown stock/prices, MOQ/order multiple/tier logic |
| Layout document → KiCad export → parser | Automated checks pass | Two placed components, 10 pads, bottom-side placement preserved; collision checks pass |
| TypeScript | Pass | npx tsc --noEmit |
| Production build | Pass | npm run build; all routes generated successfully |
| Catalogue in managed browser preview | Environment blocked | Preview-server outbound DNS fails with EAI_AGAIN; same handlers work in the development execution environment |
| 3D image in managed browser | Unverified | THREE.WebGLRenderer could not create a WebGL context |
| Final browser interactions | Blocked | Subsequent reload rejected by browser URL security policy; no workaround attempted |
| Original catalogue ZIP download | Integration blocked | Existing eelib download route requires authorized service/user access; local-upload ZIP exports are implemented |
| Direct supplier credentials | Not tested | No private ezPLM/DigiKey/Mouser credentials provided; current live data verification uses eelib's public BFF |

No GitHub push, production deployment, production database mutation or access-control relaxation was performed.

Preview follow-up: switched managed startup to the existing production build. Browser loaded the Maker Tools homepage successfully. The earlier failed reload was on a `chrome-error://` page; the normal HTTP preview opened successfully. External-data DNS and WebGL limitations are separate and have not been claimed resolved.

## 2026-10-28 upgrade verification

Passed final production `npm run build` (including TypeScript checks), original
`npm run test:maker`, `scripts/maker-upgrade-checks.ts`, and
`scripts/maker-translation-checks.ts`.

Live integration checks: public GitHub Adafruit_ADXL343_PCB at commit
13dce5a596… returned two independent design choices; chosen STEMMA QT design
imported as five files including source/license/manifest and parsed 26 PCB
footprints. Unrelated images and Git history were excluded. Numbered revision
selection and referenced sub-sheet/model resolution were checked with fixtures.
STM32G031C4U6 returned English descriptions and parameter labels with no remaining
Chinese using the glossary, 47 symbol pins, 65 pad geometries (some unnumbered),
and a 528,922-byte STEP model. The upstream symbol/footprint pin sets differ;
the detail UI explicitly flags mismatched numbering. Actual Azure credentials
were not supplied; mocked translation verifies preserved MPN/numeric/unit tokens,
cache behavior and failure fallback. Direct DigiKey/Mouser credentials are also
not supplied; earlier eelib-mediated pricing/exact AD9102 checks passed.

Browser QA at managed preview: Eagle sample and real imported Adafruit project
parse and render. iBOM displays grouped rows, front/back geometry and highlighted
placements. Sourced/Placed checkbox changes persist across tab switches; 10k
filter leaves the expected R2 row. Final UI screenshot: docs/ibom-preview.jpg.
The cloud browser's download-event API timed out after clicking offline HTML,
with no captured application error. Export generation is implemented, but actual
browser file completion was NOT verified; test this on the user's local browser.
3D source retrieval was verified, not GPU rendering in this cloud browser.
Managed preview network restrictions also mean public service tests above were
executed directly against route/adapter handlers in the executor, not claimed as
an end-to-end browser/network test. No fake catalogue data was used.

iBOM fidelity limits and upstream licensing are in public/ibom/NOTICE.md.

## 2026-10-28 viewer fixes (v3)

- Real mayermakes/00Keyboard snapshot 60435a4f3eda2c3ab4cce9f635fc255d967a8999: overlapping concentric drill holes reproduced the original triangulation hang (>15 seconds). Removing contained circular cutouts reduced 764 drill holes to 704; valid finite board geometry completes in approximately 1.2 seconds in the executor. Source board/pad coordinates are unchanged.
- Board triangulation now runs in a dedicated cancellable worker with a 20-second limit. Managed production browser imported the actual project ZIP, completed the worker, and reached renderer initialization. GPU rendering remains unverified: this browser reports a WebGL context creation failure. The UI exits its loading state and shows the English error.
- Live catalogue check ranks MIC5504-3.3YM5-TR first for MIC5504-3.3YM5. Non-exact suffix matches remain review candidates. Other candidates/results are collapsed by default.
- Nested circuit category names and viewer/model-loader UI messages are English. Live circuit endpoint returned Human-machine interface. Unknown upstream descriptions still follow the documented optional translator/fallback behavior.
- Passed production build, maker checks, translation checks, ranking/geometry/worker timeout and cancellation checks, and git diff --check.

## Project package export v4

Project origin is tracked independently from viewer model assets. GitHub, catalogue and bundled examples expose original-file downloads and a ZIP + BOM action; local uploads hide engineering-file download actions. Catalogue original files are fetched lazily through the existing authorized download route and cached for individual downloads. Missing source access produces an error, never a preview-only archive mislabeled as source.

The archive contains original/ source assets, enrichment/bom.csv, enrichment/bom.json, manifest.json and README.txt. Applied matches include MPN, manufacturer, reference, source and exact/confirmed status. Native CAD files are not rewritten.

Passed production build, maker checks, and maker-package-checks.ts: KiCad/Eagle source byte preservation, enriched metadata, local-origin rejection, empty archive rejection, traversal rejection. Browser verified example source download controls, ZIP action without an application error, and hidden controls following local upload. Actual browser download completion was not captured. Catalogue download still requires configured EELIB_DOWNLOAD_SERVICE_TOKEN and EELIB_DOWNLOAD_HOSTS; no credentials were available for live download testing. Screenshot: docs/project-package-v4.jpg.

## Tab performance v5

3D and project BOM mount lazily on first visit and stay mounted for the current project. Hidden 3D rendering is paused via the existing active/animation API. Importing another project resets visited tabs and BOM state. Catalogue model retrieval now depends on the first 3D visit and view ID, not the active tab: switching away does not abort and restart the download. At most four files load concurrently, with 25-second per-file timeouts, bounded body reads and individual error isolation. Pad construction yields after every 128 pads.

Browser verified BOM build quantity 7 survives BOM -> 3D -> BOM; opening a new KiCad project resets it to 1. Production build, geometry/ranking/worker checks, package checks and shell syntax checks pass. Cloud WebGL remains unavailable: no full 3D FPS or Mac latency claim. Live catalogue retrieval is not revalidated in this restricted preview.

start-preview.command builds production output on its first launch and serves that output on port 3000; subsequent starts reuse it. After source edits run npm run build again. start-local.command remains the development launcher.

## Screenshot fixes v6

Schematic pin numbers default on; per-symbol fallback displays pin names and numbers when source text is absent, respecting hidden pins. Regression rendering test asserts default labels and a known pin name.

Matching requests omit existing candidate lists, offers and original cell payloads; original spreadsheet data is retained when merging responses. A regression with a multi-megabyte prior result produces a request below 10 KB. The screenshot's "BOM request too large" originates in the application's 100,000-character request guard, not a distributor quota response.

All six viewer tabs share a native modal fullscreen container with exit and Escape handling. The same children remain mounted. Browser verified entering fullscreen, changing to BOM, editing quantity to 9, and exiting without losing state. Current OOKeyboard source/render does not reproduce the long white line in the screenshot; no source geometry was removed. Screenshot: docs/fullscreen-v6.jpg. Cause of the user's white line remains unconfirmed.

CAD preview and download links now precede component parameters. Live STM32F103C8T6 description and parameter labels/values have no remaining Chinese after terminology updates. Arbitrary unmatched prose still requires AZURE_TRANSLATOR_KEY (and provider region where applicable); original fallback is preserved, not silently deleted. Translation tests pass.

The originalFactory.call error is classified as a frontend module load failure; exact cause on the user's Safari session is not reproduced. Module-load failures now show recovery guidance and reload. start-local.command uses the production preview; start-dev.command retains HMR development. Complete GPU rendering remains unverified in the cloud browser.

Passed final production build, maker-v6-checks.tsx, maker-translation-checks.ts, maker-package-checks.ts, maker checks and git diff --check. No push or deployment.

## v7 layout, source schematic and pre-layout

Header, navigation and content share a centered 1440px container. Search renders every returned result. Right PART DETAILS places three CAD cards and downloads above parameters. Project BOM disables Plan Placement.

Source schematic rendering reuses eelib drawing primitives: remote drawings endpoint and local KiCad source parser, with pan, zoom and sheet selection; other formats retain the prior fallback. Live MkI returned 244 text elements and 15 filled shapes. Browser OOKeyboard rendered source fills, pins and annotations with zero unsupported source items (docs/native-schematic-v7.jpg).

Official KiCad GitLab tag 10.0.0 returned 155 libraries; Package_SO / SOIC-8 returned 23 entries; actual chosen footprint parsed 8 pads. ezPLM STM32F103C8T6 returned a 48-pad native footprint. No generic fallback is silently substituted on library errors. Geometry and raw native footprint source persist in saved layouts and native exports. Anonymous public library reads do not bypass eelib's authenticated planner endpoints.

Placement uses conservative rotated body/pad bounding boxes, bottom-side mirroring, a 0.5mm edge margin, configurable clearance and mounting-hole keepouts. Both sides participate in overlap checks. Rectangular boards only, 20–300mm. Browser rejected x=-5 and an overlap at x=50, preserving x=25; accepted x=26. Layouts invalid under these rules are rejected. These checks are not an electrical DRC or manufacturing signoff.

Planner offers 2D, split 2D+3D and 3D. Real models load when available; grey envelopes are labeled approximations. Cloud browser lacks WebGL: full GPU output is not verified. Functional-block SVG groups categories without inventing electrical connections. BOM CSV includes quantity, currency, supplier, price timestamp and best available USD price with tier/MOQ handling. Live AD9102BCPZ returned five DigiKey price tiers; Mouser returned not_carried. Missing quotes are not zero cost. Direct distributor credentials were not provided; public eelib adapter was tested from the executor. Preview browser outbound DNS to eelib is unavailable.

Production build and maker-v7-checks pass: bounds/overlap, free placement, resize rejection, footprint save/reload, native top/bottom rotated pads and drills, mounting holes, model references, escaped diagram and source pin text. Prior maker and package regression checks pass. React lifecycle review confirmed preview debounce, cancellation and conditional expensive rendering. No GitHub push or deployment.

## v8 requested interaction corrections

Component details now uses CircuitAtlas `part-usages` exact MPN records (up to upstream limit 50) rather than component reference-design documents. Same-family matches are excluded from these links. The viewer links use design-file IDs; designators are included. The separate Circuit Explorer link allows broader part/family exploration. Live STM32F103C8T6 returned 23 exact design associations; AD603AR returned none. Association coverage depends on the indexed engineering BOM.

Selecting a KiCad footprint category automatically loads every name returned by the paginated library endpoint. Keyword filtering is immediate, case-insensitive and supports multiple words; changing category clears the keyword. Live Package_SO returned 397 names; SOIC-8 filtered to 23. Preview host cannot reach external library services (fetch failed); endpoint live verification ran in the executor, not the browser.

2D renders pads and unfilled body outlines. 2D+3D uses the same full-width top-view canvas with filled body envelopes, no split view or WebGL startup. 3D retains the rotatable model view; its GPU rendering remains unverified. The top-view fill is an envelope, not a rendered STEP projection.

Movement rejects illegal placement without setting an error. Browser checked x=-5 remains x=6 with no alert; a second component placed at x=25 could not move to the occupied y=25 and stayed at y=3, with no error text. The existing rule validation still guards the document and exports.

BOM display and CSV export use English terminology immediately and standard machine translation for unmatched text when configured. Source values remain intact for matching/engineering data. Screenshot terms low-noise/variable-gain and Chinese punctuation now convert without a key. Arbitrary prose still requires Azure Translator credentials; pending/failed text is preserved with an honest notice. No LLM is used.

Production build, maker-v7-checks, maker-translation-checks, maker-v8-checks and git diff --check passed. v8 regression checks verify exact/family isolation, designator mapping, description conversion, MPN/unit preservation and invalid translation request rejection. Screenshot docs/planner-v8.jpg uses a labeled generic starter footprint for interaction QA. No push or deployment.

## v9 viewer continuity and 1337 outline

Files now contains Download project ZIP + BOM for downloadable origins; local uploads remain excluded. Browser confirmed the button and original-file rows. The browser download event timed out; download completion was not captured. Package content regression tests pass.

Schematic stays mounted per project; remote source drawing loading displays a status instead of briefly rendering the fallback engine. iBOM also stays mounted after its first visit. Active/iframe-load/ResizeObserver notifications trigger a validated parent-to-frame redraw after layout frames; full-screen changes are covered. Browser example -> iBOM -> Files -> iBOM -> Fullscreen showed pads and track (docs/ibom-v9.jpg). The user's exact intermittent Safari rendering issue is not independently reproduced.

Live CircuitAtlas project 0197c64e-03b8-7c8d-9b6b-b82247aba630 (0xCB 1337; bundle name 1337-v4.0) reproduced the reported board-outline failure. Connector footprint Edge.Cuts differ from main outline endpoints by exactly 0.01mm. The strict less-than tolerance and floating-point rounding rejected it. Inclusive 0.01mm plus 1e-7 numerical epsilon now generates one mesh with 259056 position values; larger gaps remain errors. No convex hull or invented board boundary is substituted. Model download status now distinguishes downloaded bytes from successful geometry rendering. Full GPU 3D remains unverified in this environment.

Production build, maker-v9-checks, maker-viewer-fixes-checks, maker-package-checks, TypeScript and diff checks passed. No push/deployment.

## v16 — object selection and modal lifecycle

- Added shared, reference-counted modal scroll locking; native dialog close events no longer close parent dialogs. Cleanup closes the owned dialog and restores focus. Includes React StrictMode cleanup behavior.
- Graph relationship/variant buttons open in-place component lookup dialogs. Exact catalog MPN matches show details; unresolved families show searchable catalog results.
- Symbol pins and footprint pads share selection by source pin number; a selected pad selects the matching symbol unit.
- Native schematic source hit boxes select components; wire hit areas select nets and show available source metadata/connectivity.
- New planner placement maximizes available clearance to existing footprint extents, board edges and hole keepouts, with center proximity breaking ties. Existing placements remain unchanged.
- 3D source silkscreen: KiCad SilkS primitives/text and Eagle tPlace/bPlace/name/value artwork are projected onto the actual triangulated board surface. Source archives are loaded in the background for catalog projects. Canvas text uses a browser font; it is not an exact reproduction of the EDA stroke font. Other board formats and inaccessible archives do not yet provide this artwork.
- Graph thumbnail cycles highlighted families and has slow rotational motion. Full graph has an Auto tour / Pause tour control; manual dragging pauses the tour.
- Automated checks: `npm run test:maker`, `node --import tsx scripts/interaction-geometry-checks.ts`, `node --import tsx scripts/component-graph-checks.ts`, `node --import tsx scripts/detail-display-checks.ts`, TypeScript and production build.
- Browser interaction/visual acceptance remains unverified: the available browser could not connect to the local preview (ERR_CONNECTION_REFUSED). In particular, verify fullscreen → restore → close → reopen, pin selection and 3D silkscreen appearance on a real project locally.

## v17 — schematic navigation and planner BOM

- CAD selection changes existing pad fill / pin line and text colors; removed selection circles and native SVG group focus decoration.
- Source schematic wheel events use a non-passive listener with preventDefault, scoped to the schematic SVG.
- Sheet hit boxes navigate to the supplied page or uniquely resolved source filename, with Back navigation and an unavailable-source message.
- Net inspector groups explicit source endpoints by component reference and pin number. Local KiCad source rendering now retains the connectivity reader's net/pin groups; remote drawings use canonical logical net endpoints without guessing pins.
- Planner placed-component list and BOM estimates share one full-width panel beneath the canvas. Reference buttons select placed components; canvas selection highlights the matching BOM group.
- `scripts/schematic-navigation-checks.ts` verifies reference/pin retention on the real bundled schematic fixture. Maker regression suite and production build also run.
- Browser click and visual verification is still pending because this environment could not connect its browser to the local preview port.

## v18 — project relationships and editable pricing

- Relationships tab derives current-project component neighborhoods from resolved schematic net endpoints. No cross-project co-occurrence or substitute claims are inferred. The canvas limits a neighborhood to 40 components while the connection list retains all resolved pins.
- Pricing now tries configured supplier search APIs even when ezPLM already has an exact part. Only matching full MPN/manufacturer identities contribute offers; rejected upstream demonstration responses are still excluded. A failed price row no longer aborts the batch.
- BOM shows unit and line prices, manual USD overrides, and API-price reset. Manual prices use required quantities; supplier totals respect MOQ/order multiples. CSV and subtotal share the same calculation. Editing commits on blur or Enter.
- Per-row catalog search accepts MPN/specifications and requires explicit confirmation of specification-only candidates. Planner keeps current-session matches/prices when adding parts.
- Stable scrollbar gutter avoids content recentering when Explore circuits loading and modal scroll states change.
- Maker regression suite, manual-pricing checks, TypeScript and production build run. Live authenticated supplier responses and browser visual/interaction acceptance remain unverified in this environment.

## v19 — pointer-anchored zoom, graph interaction and identity synchronization

- Source schematic zoom derives the cursor coordinate with SVG getScreenCTM and preserves it by updating pan and zoom together. Native non-passive wheel handling still prevents document scrolling.
- Project graph now renders a distributed component/net network rather than rebuilding a single selected-node ring. Component circles and net diamonds are draggable, background pan and cursor-anchored zoom are supported, and click selects the right-hand inspector without rearranging positions. Source connectivity remains the only edge evidence.
- Exact/confirmed BOM selections automatically update the project PartIr identities and therefore iBOM and project ZIP metadata. Pending candidates are not written. Original project files remain unchanged.
- BOM matching now runs at most three single-row lookups at once with per-row failure handling, request timeouts, progress and visible provider statuses. MPN-like Value fields are searched without long footprint library paths; passive package queries use standard package size where available.
- No evidence from the screenshots establishes a quota failure. Live API quota/authentication status is unverified. Provider status is displayed per selected row; generic specifications remain user-confirmed candidates.
- Maker, manual-pricing and schematic connectivity regressions plus TypeScript and production build run. Browser interaction acceptance remains pending due to the unavailable browser connection to the local preview.

## v20 — symbol readability and persistent BOM review

- Symbol pin names/numbers increased from 0.014 to 0.034 of drawing extent (about 4 px to 10 px at a 300 px fit view). Pin strokes now use 1.35 px non-scaling strokes and blue contrast; symbol outlines use 1.2 px non-scaling strokes. Source symbol geometry and pin mapping are unchanged.
- BOM Match Review is sticky beneath the project dialog header, with viewport-limited height and independent scrolling. Changing active rows resets the review panel scroll to its top. Narrow screens show the review above the table.
- Production build/type validation performed. Browser visual acceptance remains unverified in this environment.

## v21 — native symbol typography, thumbnail fallback and PCB selection

- Removed project Relationships tab and ProjectGraph implementation (global component graphs remain).
- CAD text uses source KiCad pin font sizes, pin-name offset and visibility flags. Existing preview geometry is unchanged; line widths use source/default mm values. Raw symbol retrieval is bounded to 2 MB and allowlisted HTTPS hosts without redirects. Unavailable source falls back to KiCad defaults. Browser Arial is not KiCad's native stroke font.
- Real STM32G031C4T6 source inspected: 1.27 mm font, name offset 0 and hidden pin names; enriched preview respects those source settings.
- Cards try PCB then schematic thumbnail, including image-load failure fallback. Missing upstream thumbnails remain explicitly unavailable.
- PCB tracks, pads and vias select net; matched pads/tracks highlight, other nets dim, right inspector lists connected component/pad tree. Component hit regions now sit behind copper interaction targets; selecting a component clears the net and highlights its pads.
- Source typography regression verifies explicit 1.016/0.762 mm sizes, offset and unchanged pin coordinates. Maker regression, TypeScript and production build passed. Browser visual/interaction verification pending; no claim of live UI acceptance.
