/**
 * 3D for EasyEDA (Standard) boards. Tindie addition.
 *
 * The parser keeps EasyEDA's own tokens: coordinates and sizes are in 10 mil (0.254 mm) although the
 * IR labels them mm, and copper layers keep EasyEDA's names (TopLayer / BottomLayer / Multi-Layer).
 * The 2D views only need proportions; the 3D scene needs millimetres (board thickness, models) and
 * KiCad layer names, so it gets a converted copy (`pcbInMm`).
 *
 * EasyEDA boards name their 3D models by EasyEDA library id (hosted by EasyEDA, not in the project),
 * so there is nothing to load from the files. Each part's `outline3D` node does give the model's
 * footprint on the board; `easyEdaBodies` turns those into body envelopes, with heights taken from
 * the model name where EasyEDA encodes it (…-H0.8, D8.0-H8.0) and typical heights otherwise.
 */
import type { BodyEnvelope } from "@/vendor/canon/components/BoardScene";
import type { InputAsset, PcbIr } from "@/vendor/canon/lib/eda/types";

const MM = 0.254;
const decoder = new TextDecoder();

export function isEasyEdaStandard(pcb: PcbIr) {
  return /easyeda standard/i.test(String((pcb as any).coordinateSystem?.sourceUnits ?? ""));
}

/** Fields holding lengths (10 mil in EasyEDA Standard); everything else (angles, ids, layers) stays. */
const LENGTH_KEYS = new Set(["x", "y", "width", "height", "size", "drill", "thickness", "radius", "diameter"]);
const SKIP_KEYS = new Set(["sourceRef", "sourceRefs", "raw", "coordinateSystem", "physicalDimensions", "stackup"]);
const LAYER = (layer: string) =>
  layer === "TopLayer" ? "F.Cu" : layer === "BottomLayer" ? "B.Cu" : layer === "Multi-Layer" ? "*.Cu" : layer;

function scale(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => scale(v, key));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SKIP_KEYS.has(k) ? v : scale(v, k);
    return out;
  }
  if (!LENGTH_KEYS.has(key)) return value;
  if (typeof value === "number") return value * MM;
  if (typeof value === "string" && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(value)) return String(Math.round(Number(value) * MM * 1e6) / 1e6);
  return value;
}

/** The board in millimetres with KiCad copper layer names, for the 3D scene. */
export function pcbInMm(pcb: PcbIr): PcbIr {
  const out = scale(pcb) as PcbIr;
  return { ...out, pads: out.pads.map((p) => ({ ...p, layers: p.layers.map(LAYER) })) };
}

/** Body height (mm) for an EasyEDA 3D model name. */
export function bodyHeight(title: string) {
  const t = title.toUpperCase();
  const h = t.match(/(?:^|[-_])H(\d+(?:\.\d+)?)(?:[-_]|$)/);
  if (h) return Math.min(25, Number(h[1]));
  if (/HDR|PIN.?HEADER|HEADER/.test(t)) return 8.5;
  if (/JST|XH|CONN|TERMINAL/.test(t)) return 7;
  if (/USB/.test(t)) return 3.3;
  if (/ESP32|WROOM|WROVER|MODULE|WIRELM/.test(t)) return 3.1;
  if (/IND|INDUCTOR/.test(t)) return 3;
  if (/KEY|SW|BUTTON|TACT/.test(t)) return 2.5;
  if (/SMA|SMB|SMC|SOD/.test(t)) return 2.2;
  if (/SOIC|SSOP|ESSOP|TSSOP|MSOP|SOP/.test(t)) return 1.6;
  if (/SOT/.test(t)) return 1.2;
  if (/QFN|DFN|SON|LGA/.test(t)) return 0.9;
  if (/QFP/.test(t)) return 1.6;
  if (/0201|0402/.test(t)) return 0.4;
  if (/0603/.test(t)) return 0.6;
  if (/0805|1206/.test(t)) return 0.8;
  return 1.5;
}

/** Body envelopes from the 3D outlines in the project's EasyEDA Standard PCB files. */
export function easyEdaBodies(pcb: PcbIr, assets: readonly InputAsset[] = []): BodyEnvelope[] {
  const byPosition = new Map(pcb.footprints.map((f) => [`${f.position?.x},${f.position?.y}`, f]));
  const bodies: BodyEnvelope[] = [];
  for (const asset of assets) {
    if (!/\.json$/i.test(asset.path) || asset.bytes.length > 40 * 1024 * 1024) continue;
    let doc: any;
    try {
      doc = JSON.parse(decoder.decode(asset.bytes));
    } catch {
      continue;
    }
    if (String(doc?.head?.docType) !== "3" || !Array.isArray(doc.shape)) continue;
    for (const shape of doc.shape as string[]) {
      if (typeof shape !== "string" || !shape.startsWith("LIB~")) continue;
      const parts = shape.split("#@$");
      const head = parts[0].split("~");
      const footprint = byPosition.get(`${head[1]},${head[2]}`);
      for (const part of parts) {
        if (!part.startsWith("SVGNODE~")) continue;
        let node: any;
        try {
          node = JSON.parse(part.slice(8));
        } catch {
          continue;
        }
        if (node?.attrs?.c_etype !== "outline3D") continue;
        const xs: number[] = [],
          ys: number[] = [];
        const visit = (n: any) => {
          const pts = String(n?.attrs?.points ?? "").trim().split(/[\s,]+/).map(Number);
          for (let k = 0; k + 1 < pts.length; k += 2)
            if (Number.isFinite(pts[k]) && Number.isFinite(pts[k + 1])) {
              xs.push(pts[k]);
              ys.push(pts[k + 1]);
            }
          for (const c of n?.childNodes ?? []) visit(c);
        };
        visit(node);
        if (xs.length < 2) continue;
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
        bodies.push({
          reference: footprint?.reference || String(node.attrs.title || "part"),
          x: ((x0 + x1) / 2) * MM,
          y: ((y0 + y1) / 2) * MM,
          w: (x1 - x0) * MM,
          h: (y1 - y0) * MM,
          height: bodyHeight(String(node.attrs.title || "")),
          rotation: 0,
          bottom: (footprint?.side as string | undefined) === "back",
        });
      }
    }
  }
  return bodies;
}
