# Embedded component relationships (v11)

The home-page PCB illustration is replaced by a compact relationship graph. Components includes a second embedded graph that follows the selected part. Click either preview to open the full graph in a native modal dialog, with Escape/Close, focus containment and focus restoration. Independent navigation and the standalone tool route are removed.

Data is read from the same public CircuitAtlas service as Explore circuits: the first 24 matching catalogue designs and their real BOM detail endpoints. The home graph uses an unfiltered page; Components filters designs by the selected MPN. This is a bounded selection, not a representative sample or full-corpus ranking. A part may be absent from the visible top 24 if it has no usable identity. The upstream catalogue may match part families.

Algorithm:
- Group by catalogue projectId, or design id if absent; count a component at most once per project across BOM rows and design variants.
- Use explicit BOM MPN or an upstream `keyKind=exact` BOM value. Mark BOM-value identities as MPN unverified. Preserve punctuation and separate manufacturers. No fuzzy merging or inferred manufacturer.
- Ignore withdrawn designs, DNP rows, missing/placeholder identifiers, generic symbols and resistor/capacitor values misfiled as MPNs.
- Node size represents distinct project count in the loaded selection. Edge width represents shared-project count; Jaccard = shared / union project count. Co-occurrence never asserts electrical connectivity or interchangeability.
- Show at most 24 nodes ranked by project count, prioritizing an exact label matching the selected component. Links open actual source engineering projects and the existing component/CAD search.
- Display loaded/requested BOM counts, failed requests, truncated BOM count, identified versus displayed nodes, generation time and upstream snapshot date. Empty or unavailable sources show an explicit state, never fabricated fallback data.

Performance: four concurrent detail reads, 7-second detail deadlines, 10-second catalogue deadline, 60-second route budget. Bounded 10-minute memory cache and in-flight deduplication for 32 queries, plus client result reuse. These are per-process caches, not a persistent global graph index. No new dependency, model API or database write.

Validation: deterministic algorithm tests cover project deduplication, duplicate rows, manufacturer separation, DNP/passive-value exclusion, identity provenance, focused selection and Jaccard. Existing Maker regression tests pass. Live request read 24 BOMs across 23 project IDs successfully, from the public catalogue snapshot dated 2026-10-25. Full browser interaction verification remains pending in an environment with local preview browser access.
