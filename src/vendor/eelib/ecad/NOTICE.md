# eelib CAD preview engine (vendored)

Source: gongyueetree/eelib @ 77ddf590b5af1d2b37e89fbd409bcc950c4f950c

| File here | Upstream |
|---|---|
| preview.ts | eelib-bff/src/ecad/preview.ts (KiCad 5 `.lib` conversion removed) |
| sexpr.ts | eelib-bff/src/refir/core/eda/sexpr.ts |
| view-geometry.ts | eelib-bff/src/refir/core/eda/view-geometry.ts |
| kicad-symbol.ts | `symbolDefinition` from eelib-bff/src/refir/core/design-assets/kicad.ts |

The engine turns a KiCad symbol library / footprint into the drawable `SymbolPreview` /
`FootprintPreview` JSON that `components/maker/CadPreview.tsx` renders. Update by re-copying
these files from eelib; do not edit the logic here.
