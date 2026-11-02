# Component display and catalogue metadata (v15)

CAD: missing symbol panels are omitted; missing footprint panels are omitted; when neither symbol nor footprint preview is available the entire CAD preview is omitted. Available panels reflow. No empty pin table is shown when the symbol is absent.

English display: removed Show source text and the source-language toggle. Added deterministic translations for the remaining screenshot fields, including slew rate, input bias, circuit count, supply current, voltage span, noise figure and frequency response. Existing optional Azure NMT handles other Chinese strings without a generative model. If an unrecognized Chinese field remains and NMT is not configured/available, the English-only UI explicitly says its English label/value is unavailable instead of inventing a translation. Original API values remain in originalText for auditing. This is not a claim that the full source corpus has been translated.

Related components: Network-icon button beside the MPN in the Components details and planner part modal opens the real-BOM graph. Selected MPN or recognized family is focused at the center. Unknown identities are explicitly noted. Loading, empty and failure states are handled; the normal embedded graph remains available.

Stars and licenses: project cards explicitly show each field and distinguish missing stars from 0. License strings/SPDX/declared fields are normalized without inventing a license. Existing metadata can be ordered highest-stars-first among loaded records; that is never labeled global ranking.

BLOCKER: the public CircuitAtlas list currently lacks stars and often declares no license. Its source schema does not support star sorting. The parts.eelib.io OpenAPI exposes HTTPBasic-protected project reads; GET /api/projects/{bom_id} returned HTTP 401 in this environment. No credentials or translation service keys were present. No protected data was accessed and no upstream database/configuration was changed.

Prepared integration: EELIB_RANKED_CIRCUITS_URL points to a read-only CircuitAtlas-compatible ranked list; optional EELIB_RANKED_CIRCUITS_TOKEN stays server-side. Its GET supports q/module/category/mpn/cursor/limit and sort=stars_desc; response is {sort:'stars_desc',items:[{id,githubStars,license:{declared},...existingProjectFields}],total,nextCursor,facets}. The upstream must rank the COMPLETE matching catalogue BEFORE applying pagination and preserve existing design IDs. Authentication/this endpoint must be provided by the data owner before full catalogue ranking is operational. These environment variables are an integration contract, not a claim that the endpoint already exists.

Validation: screenshot terminology and numeric preservation tests; metadata normalization tests (0 versus unknown, SPDX license, descending order); TypeScript/build; existing Maker checks. Browser visual interaction verification remains pending.
