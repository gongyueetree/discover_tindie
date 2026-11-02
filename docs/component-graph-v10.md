> Superseded by v11: the active implementation uses real BOM data and embedded modal entry points. See component-graph-v11.md.

# Component graph (v10)

Open `/tools/graph` from the Maker Tools navigation or home card.

This is a reconstruction of the interactions described in the earlier component knowledge-graph conversation, not a recovered copy of that artifact. Its source was not available. The graph contains 12 illustrative nodes and 16 illustrative relationships. All usage counts, edge strengths and candidate relationships are sample data; the interface labels this explicitly. No EELIB corpus statistics or substitution verification is claimed.

- Select nodes to highlight their immediate neighbors and update the details panel without changing positions.
- Drag nodes or pan empty space. A movement threshold separates selection from dragging, including touch input. Zoom controls and Reset view are available.
- Keyboard users can Tab to nodes and select with Enter/Space.
- Filter co-occurrence and alternative candidate edges; search sample node MPNs.
- Component/CAD and open-project links use the existing live search pages; their results are independent of the sample graph.
- No model API, login, new dependency or database mutation is involved.

To integrate the actual mined dataset, replace the explicitly marked static sample dataset with an authenticated server-side adapter once the real graph API and schema are available. Keep source provenance and evidence counts, and distinguish co-occurrence from electrically verified relationships. Never infer drop-in replacements merely from co-occurrence.

Validation: TypeScript check passed. Production build and existing Maker regression suite are run before packaging. Browser verification was unavailable: the cloud browser could not reach the local development server.
