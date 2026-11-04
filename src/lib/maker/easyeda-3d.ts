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
        const uuid = String(node.attrs.uuid || "");
        const rot = String(node.attrs.c_rotation || "0,0,0").split(",").map((v) => Number(v) || 0);
        bodies.push({
          ...(/^[0-9a-f]{32}$/.test(uuid)
            ? { model: { uuid, rotation: [rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0] as [number, number, number], z: (Number(node.attrs.z) || 0) * MM } }
            : {}),
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

/* ------------------------------------------------------------------ EasyEDA 3D models */

export type EasyEdaModelRef = { uuid: string; rotation: [number, number, number]; z: number };
type ObjMesh = { color: [number, number, number]; opacity: number; positions: number[] };

/** EasyEDA's OBJ: materials inline (newmtl … Kd … d … endmtl), then v lines, then usemtl + f groups. Units mm. */
export function parseEasyEdaObj(text: string): ObjMesh[] {
  const materials = new Map<string, { color: [number, number, number]; opacity: number }>();
  let current: string | null = null;
  const vertices: number[][] = [];
  const meshes = new Map<string, ObjMesh>();
  let mesh: ObjMesh | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [tag, ...rest] = line.split(/\s+/);
    if (tag === "newmtl") {
      current = rest[0] ?? "";
      materials.set(current, { color: [0.6, 0.6, 0.6], opacity: 1 });
    } else if (tag === "Kd" && current !== null) {
      const c = rest.slice(0, 3).map(Number);
      if (c.every(Number.isFinite)) materials.get(current)!.color = c as [number, number, number];
    } else if (tag === "d" && current !== null) {
      // EasyEDA writes transparency here (0 = opaque).
      const d = Number(rest[0]);
      if (Number.isFinite(d)) materials.get(current)!.opacity = Math.max(0.15, 1 - Math.min(1, Math.max(0, d)));
    } else if (tag === "endmtl") current = null;
    else if (tag === "v") {
      const v = rest.slice(0, 3).map(Number);
      if (v.length === 3 && v.every(Number.isFinite)) vertices.push(v);
    } else if (tag === "usemtl") {
      const name = rest[0] ?? "";
      const m = materials.get(name) ?? { color: [0.6, 0.6, 0.6] as [number, number, number], opacity: 1 };
      mesh = meshes.get(name) ?? { ...m, positions: [] };
      meshes.set(name, mesh);
    } else if (tag === "f") {
      if (!mesh) {
        mesh = { color: [0.6, 0.6, 0.6], opacity: 1, positions: [] };
        meshes.set("", mesh);
      }
      const idx = rest.map((t) => {
        const n = parseInt(t.split("/")[0], 10);
        return n < 0 ? vertices.length + n : n - 1;
      });
      if (idx.some((i) => !(i >= 0 && i < vertices.length))) continue;
      for (let k = 1; k + 1 < idx.length; k++) for (const i of [idx[0], idx[k], idx[k + 1]]) mesh.positions.push(...vertices[i]);
    }
  }
  return [...meshes.values()].filter((m) => m.positions.length >= 9);
}

const objCache = new Map<string, Promise<ObjMesh[] | null>>();
function fetchObj(uuid: string) {
  let p = objCache.get(uuid);
  if (!p) {
    p = fetch(`/api/maker/easyeda-model/${uuid}`)
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => (t ? parseEasyEdaObj(t) : null))
      .catch(() => null);
    objCache.set(uuid, p);
  }
  return p;
}

/** XY extent of points after rotating about Z by `deg`. */
function extentAfter(positions: number[], deg: number) {
  const c = Math.cos((deg * Math.PI) / 180),
    s = Math.sin((deg * Math.PI) / 180);
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] * c - positions[i + 1] * s,
      y = positions[i] * s + positions[i + 1] * c;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return [x1 - x0, y1 - y0];
}

/**
 * A body's EasyEDA model as a three.js group in board millimetres, origin at the outline centre and
 * z = 0 on the board surface (BoardScene places and flips it). null when the model is unavailable or
 * does not fit the part's outline (then the envelope stays): EasyEDA's own placement rules (centre on
 * the 3D outline, bottom on the board plus the `z` offset, c_rotation) as easyeda2kicad applies them.
 */
export async function easyEdaModelObject(envelope: BodyEnvelope, THREE: typeof import("three")): Promise<import("three").Object3D | null> {
  const body = envelope as BodyEnvelope & { model?: EasyEdaModelRef };
  if (!body.model || typeof body.model !== "object") return null;
  const model = body.model;
  const meshes = await fetchObj(model.uuid);
  if (!meshes?.length) return null;
  const all = meshes.flatMap((m) => m.positions);
  // X / Y tilts first (rare), then the Z turn that makes the model's footprint match the outline.
  const [rx, ry, rz] = model.rotation;
  const tilt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((rx * Math.PI) / 180, (ry * Math.PI) / 180, 0, "XYZ"));
  const tilted = new Float32Array(all);
  new THREE.BufferAttribute(tilted, 3).applyMatrix4(tilt);
  const target = [body.w, body.h];
  const fit = (deg: number) => {
    const [w, h] = extentAfter(Array.from(tilted), deg);
    return Math.abs(w - target[0]) + Math.abs(h - target[1]);
  };
  const turn = [rz, -rz].reduce((best, d) => (fit(d) < fit(best) - 1e-6 ? d : best), rz);
  const [w, h] = extentAfter(Array.from(tilted), turn);
  // Wrong units or a different part: keep the envelope rather than show a misleading model.
  if (!(w > 0 && h > 0) || w / body.w > 3 || body.w / w > 3 || h / body.h > 3 || body.h / h > 3) return null;
  const matrix = new THREE.Matrix4().makeRotationZ((turn * Math.PI) / 180).multiply(tilt);
  const group = new THREE.Group();
  const box = new THREE.Box3();
  for (const m of meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
    g.applyMatrix4(matrix);
    g.computeVertexNormals();
    g.computeBoundingBox();
    box.union(g.boundingBox!);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(m.color[0], m.color[1], m.color[2]),
      roughness: 0.6,
      metalness: 0.1,
      side: THREE.DoubleSide,
      transparent: m.opacity < 1,
      opacity: m.opacity,
    });
    group.add(new THREE.Mesh(g, material));
  }
  const centre = box.getCenter(new THREE.Vector3());
  for (const child of group.children) (child as import("three").Mesh).geometry.translate(-centre.x, -centre.y, -box.min.z + model.z);
  return group;
}
