# InteractiveHtmlBom integration

Web renderer from https://github.com/openscopeproject/InteractiveHtmlBom,
master snapshot retrieved 2026-10-28 (upstream version.py LAST_TAG v2.12.0).
MIT license in LICENSE. Bundled Split.js, PEP.js and LZ-string retain upstream notices.

Original Git blob IDs:
- ibom.html a6e5a6d2383d1df17be2372639390768d878925d
- ibom.js d88a6f86e1eb33c44826863c612a6ea02750f672
- render.js 584e45f66f3b9d1475b51b026c5010bf83cb7c6d
- util.js 0d1d8da03d1ea461dc2172b43398afc87a193007
- table-util.js 503b9eb5d3702952b30cfdb2e80e09181107fdcd
- ibom.css cbd0e38edae6763ac9d2e20aedfa7ef245886626
- split.js 37fd5d7913dd186d37cfdf9f30a3ee980089897d
- pep.js 744f0f4daa9c04237b30eb7f0b795654bdf55a82
- lz-string.js f558b4aaef541875e4edd492cf54bde35fa1a596

Local changes: ibom.html has a restrictive CSP; ibom.js escapes imported cell/filter
text, uses textContent for imported metadata/checkbox labels, and does not turn
part fields into HTML links. Tindie's TS adapter converts existing parsed project
geometry and BOM into the upstream web data schema. React wrapper embeds the
renderer in a sandbox without same-origin access, relays bounded progress data
to browser storage, adds Tindie styling, and exports self-contained HTML.
No upstream Python/KiCad installation is needed.

Fidelity: the adapter renders parsed outlines, footprint graphics, pads, tracks,
vias, and net associations. Source-parser omissions remain omissions: copper zone
polygons and silk/fab text glyphs are not synthesized. Custom pad shapes are shown
as their available rectangular bounds. No DRC, routing, AI analysis, or fabrication
sign-off is performed. DNP/variant-excluded footprints stay visible but are excluded
from BOM quantities. Unknown assembly states remain labeled unknown.
