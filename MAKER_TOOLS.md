# Tindie Maker Tools — local development

Run `npm ci` then `npm run dev`. Standard local Next.js address: http://localhost:3000. This checkout has not been pushed or deployed. In the ChatGPT workspace, use the managed preview URL returned by `sites-preview start`.

## Implemented

- Existing Discover directory/news/blog queries preserved at `/discover` and below the new landing page. Without the existing database, the real resource seed directory is shown; no news is fabricated.
- Public tool navigation at `/tools/components`, `/tools/circuits`, `/tools/viewer`, `/tools/bom`, `/tools/planner`. No visitor account or model API is required.
- eelib public component, reference-design, pricing and CircuitAtlas integrations through server routes. Exact variants, source status, datasheets and available CAD downloads. Component and BOM transfer into the manual layout workspace.
- Browser-local KiCad and Eagle 6+ XML schematic/PCB parsing, layers, net highlighting, component inspection, file inventory, ZIP export, BOM transfer. Canon's other parser adapters remain available, but compatibility is not guaranteed for every proprietary format. No IR analysis UI or AI design functions.
- 3D board/pad scene, included STEP/VRML loading through OCCT workers and allowlisted official KiCad/Espressif model endpoints. Eagle XML does not contain component STEP models: board-only geometry must not be mistaken for a full assembly. A WebGL-capable browser is required.
- CSV/TSV BOM import with editable header mapping, original-field preservation, deterministic full-MPN/manufacturer/package checks, candidate confirmation, supplier quotes, MOQ/tier/stock-aware priced subtotal, normalized CSV export. Specifications alone never silently become a confirmed part. XLS/XLSX input is not implemented yet; export those files as CSV.
- protopcb manual layout: generic footprints, drag/keyboard movement, grid, rotation, top/bottom, lock, board dimensions, overlap/bounds checks, validated JSON save/open and KiCad PCB export. Imported unknown packages are clearly marked 5 × 5 mm placeholders. Not a routed or manufacturing-ready board. No AI arrangement or analysis.

## Runtime data and credentials

Default `EELIB_PUBLIC_API_BASE=https://eelib.io/api/proxy`. The public component/catalogue/preview/pricing APIs were checked without logging in. The upstream service retains its guest quota; availability is not guaranteed.

Optional server-only credentials (never use `NEXT_PUBLIC_`):

- `EZPLM_API_BASE` / `EZPLM_API_KEY` / `EZPLM_API_SECRET` — inspect `src/vendor/bom2buy/partdata/ezplm.ts` for the original adapter's supported settings.
- `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET`, `DIGIKEY_ENV=production` — direct DigiKey search. Sandbox is not presented as live supply.
- `MOUSER_API_KEY` — direct Mouser search.
- Existing Discover database environment from the upstream application.

Part numbers/specifications are sent to configured supplier services only when the visitor runs matching/search. Local engineering file bytes are parsed in-browser. Parts transferred between tools stay in the current browser tab's session storage.

### Original catalogue ZIP downloads: integration still required

The current eelib `POST /circuit-atlas/designs/:id/download` explicitly requires an authenticated user. Public preview access does **not** authorize original-file downloads. No access control was removed, and no production eelib code/database was modified.

The Tindie download route has an explicit service-integration hook: `EELIB_DOWNLOAD_SERVICE_TOKEN` and comma-separated `EELIB_DOWNLOAD_HOSTS`. These settings alone do not create authorization: eelib must actually support and authorize that service credential for the public catalogue. A normal guest cannot currently use it. Until then, the UI reports this limitation, while local-upload ZIP/file export works. Keep unpublished/private user projects outside a future public catalogue download scope.

## Source reuse

Vendored core snapshots are under `src/vendor`; app-specific UI and service adapters under `src/components/maker` and `src/lib/maker`.

| Source repository | Snapshot | Reused portion |
|---|---|---|
| gongyueetree/tindie-app | 9d9541c59f091bffff4e7b016ce4692e681f334c | Existing app, Discover UI/data access |
| gongyueetree/canon-eda-ir-agent | 499455ab6151ffda83ade72daf144c7c7355bc54 | Parsing, internal geometry, SVG/Three.js/OCCT viewers; added Eagle XML adapter |
| gongyueetree/protopcb | ba4a5f5acd1ff0756116d45e9a8893038abe0efb | Document schema, geometry/pad definitions, collision, KiCad export |
| gongyueetree/bom2buy | 0597a316be065afefeb44ae8805bec6c4838ac7a | BOM normalization, references/packages/MPN identity, ezPLM/DigiKey adapters |
| gongyueetree/eelib | 1fe32f4dabd17a1797be90f7f51933fb7f8d2799 | Reviewed CircuitAtlas/PartBridge contracts; consumes public BFF rather than browser access to its database |

The internal canonical geometry representation is retained because the renderers depend on it. It is not exposed as an IR analysis product. Source provenance and original code comments are preserved.

## Validation

- `npm run test:maker`: KiCad/Eagle parse fixtures, net/pad/outline checks, exact-vs-ambiguous matching, MOQ/tier totals, missing-price behavior and KiCad export/parse round trip.
- `npm run test:maker:live`: actual local API handlers → eelib public parts/catalogue/parsed-project/pricing. This uses the network and upstream guest quota.
- `npx tsc --noEmit`; `npm run build`.

Managed preview limitations observed in this environment: the preview server's external DNS returns EAI_AGAIN for eelib even though the development execution environment reaches it; the cloud browser cannot create a WebGL context. Therefore live data flows were tested through the same API handlers in Node, and 3D visual QA remains unverified here. No network permission or browser security changes were made. Run on your own machine for a full integration preview.

Before production, use a durable shared rate limiter/cache and a licensed service credential arrangement for supplier APIs and public downloads. The current process-local limiter is suitable only as a development safeguard.

## Preview startup fix

The managed preview launcher now serves the existing `.next-build` production build using `next start`. Standard `npm run dev` still uses the development server. This avoids the container-specific `uv_resident_set_memory` failure in Next development instrumentation. Rebuild with `npm run build` before restarting managed preview after source edits. This is local execution, not a production deployment.

## October 28 update: GitHub, English CAD details, project BOM and iBOM

- Navigation and content use a shared centered width. Component detail includes
  zoom/pan SVG symbol and footprint previews, multi-unit symbols, pin/pad tables,
  numbering mismatch notice, and lazy STEP/VRML model loading through a bounded
  trusted-host proxy (default qn.ezplm.com).
- `english.ts` converts known electronics terminology without network calls.
  `translation.ts` optionally uses **Azure Translator v3**, a conventional machine
  translation service, not a generative model. Configure AZURE_TRANSLATOR_KEY and
  AZURE_TRANSLATOR_REGION in .env.local for arbitrary Chinese descriptions.
  Original descriptions/parameters remain available. Partial results are labeled;
  manufacturer names, MPNs, CAD names, units, and numeric tokens are not invented.
  No upstream database content is overwritten. Credentials have not been supplied
  or tested against a real translation account.
- Public GitHub imports resolve the current default branch (or explicit tree/blob
  ref) to an immutable commit, inspect its tree, exclude backup/firmware/output
  folders, and enumerate independent designs. Recognizable numeric revisions are
  reduced to the highest revision in each family. Folder naming cannot prove the
  author's intended latest release; review the offered design and pinned commit.
  Import includes chosen roots and referenced local sheets/models/libraries only,
  not history or unrelated files. Limits: 200 files, 25 MB per file, 75 MB total.
  Private repositories, recursive trees marked truncated, and Git LFS content are
  not silently imported. Missing dependencies are listed in TINDIE-IMPORT.json.
  Optional MAKER_GITHUB_TOKEN increases the public API quota. Snapshot selections
  expire after 30 minutes and are stored in this local server's memory; a future
  multi-instance deployment must move them to shared expiring storage.
- Project BOM embeds the matching workbench. ezPLM/eelib catalogue lookup precedes
  configured DigiKey/Mouser fallback. Exact or explicitly confirmed candidates
  can be applied to the in-memory project and iBOM; exported original source files
  are not rewritten. Missing distributor credentials are surfaced in status.
- iBOM uses the actual InteractiveHtmlBom web renderer, not a screenshot. Supports
  board selection, grouped/ungrouped BOM, reference/spec search, front/back views,
  BOM-to-PCB and PCB-to-BOM highlight, net highlight, Sourced/Placed checkboxes,
  display controls, and self-contained offline HTML export. Progress is saved
  locally per board geometry; no account/server user database is required.
  See public/ibom/NOTICE.md and LICENSE for upstream hashes, modifications and
  fidelity limits (notably absent source-parser copper fill/text geometry).

Additional checks:
```
node --import tsx scripts/maker-upgrade-checks.ts
node --conditions=react-server --import tsx scripts/maker-upgrade-live.ts
```

## Viewer fixes v3

PCB triangulation is isolated in a worker with cancellation and a 20-second timeout. Contained circular drill cutouts are deduplicated before extrusion; parsed project data remains unchanged. Component/BOM candidate display prioritizes full MPN and suffix proximity, retaining explicit review for non-exact matches. Additional candidates are collapsed. Nested category display labels and model-loader status messages use English. See VALIDATION.md for real-project tests and GPU validation limits.

## v7 additions

- Native eelib schematic primitives via `/api/maker/drawings/{viewId}` and vendored KiCad drawing parser.
- `/api/maker/library` exposes pinned official KiCad GitLab libraries; `kind=file` returns native source; `kind=ezplm` resolves native footprint assets through existing component APIs with an allowlist.
- Pre-layout preserves raw source, checks placement, provides three view modes and exports category SVG / priced BOM CSV. It does not infer net connectivity or perform electrical design.
- Project BOM removes placement actions; component search shows all returned results; right-side CAD cards precede parameters.

## v8

Exact part-to-design links use CircuitAtlas part-usages. KiCad category selection loads all names automatically and supports local keyword filtering. Top-view modes distinguish footprint outlines from filled body envelopes; 3D is separate. Placement rejection is silent for movement. BOM display/export translate descriptions through terminology plus optional non-LLM Azure translation, using bounded `/api/maker/translate` requests while retaining original engineering data.
