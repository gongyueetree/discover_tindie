/** Eagle 6+ XML adapter for the Canon viewer. No network or model calls. */
import { SaxesParser } from "saxes";
import type {
  InputAsset,
  SourceAsset,
  PartIr,
  PcbIr,
  SchematicIr,
  NetIr,
  IrPoint,
} from "./types";
import type { KicadParseOutput } from "./kicad";
import {
  sourceRef,
  stableId,
  diagnostic,
  withoutExtension,
  basename,
} from "./util";
type X = {
  name: string;
  a: Record<string, string>;
  children: X[];
  text: string;
};
function xml(text: string): X {
  if (/<!ENTITY/i.test(text))
    throw Error("Eagle XML entities are not supported");
  const root: X = { name: "root", a: {}, children: [], text: "" };
  const stack = [root];
  const p = new SaxesParser();
  p.on("opentag", (t) => {
    const n: X = {
      name: t.name,
      a: t.attributes as Record<string, string>,
      children: [],
      text: "",
    };
    stack.at(-1)!.children.push(n);
    stack.push(n);
  });
  p.on("closetag", () => {
    stack.pop();
  });
  p.on("text", (s) => {
    stack.at(-1)!.text += s;
  });
  p.write(text).close();
  return root;
}
const kids = (x: X | undefined, n: string) =>
  x?.children.filter((c) => c.name === n) || [];
const child = (x: X | undefined, n: string) => kids(x, n)[0];
const num = (x: X, k: string, d = 0) => Number(x.a[k] ?? d);
const pt = (x: number, y: number): IrPoint => ({
  x: String(x),
  y: String(-y),
  unit: "mm",
});
function rotate(x: number, y: number, rot = "", ox = 0, oy = 0) {
  if (rot.includes("M")) x = -x;
  const r = (Number(rot.replace(/[^0-9.-]/g, "")) * Math.PI) / 180 || 0;
  return {
    x: ox + x * Math.cos(r) - y * Math.sin(r),
    y: oy + x * Math.sin(r) + y * Math.cos(r),
  };
}
function wirePoints(
  w: X,
  transform = (x: number, y: number) => ({ x, y }),
): IrPoint[] {
  const x1 = num(w, "x1"),
    y1 = num(w, "y1"),
    x2 = num(w, "x2"),
    y2 = num(w, "y2"),
    angle = (num(w, "curve") * Math.PI) / 180;
  let out = [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ];
  if (Math.abs(angle) > 1e-8) {
    const dx = x2 - x1,
      dy = y2 - y1;
    const t = 1 / (2 * Math.tan(angle / 2));
    const cx = (x1 + x2) / 2 - dy * t,
      cy = (y1 + y2) / 2 + dx * t;
    const r = Math.hypot(x1 - cx, y1 - cy),
      a = Math.atan2(y1 - cy, x1 - cx);
    out = Array.from(
      { length: Math.max(3, Math.ceil(Math.abs(angle) * 16) + 1) },
      (_, i) => {
        const count = Math.max(3, Math.ceil(Math.abs(angle) * 16) + 1);
        return {
          x: cx + r * Math.cos(a + (angle * i) / (count - 1)),
          y: cy + r * Math.sin(a + (angle * i) / (count - 1)),
        };
      },
    );
  }
  return out.map((p) => {
    const v = transform(p.x, p.y);
    return pt(v.x, v.y);
  });
}
export function parseEagle(
  inputs: InputAsset[],
  assets: SourceAsset[],
): KicadParseOutput {
  const out: KicadParseOutput = {
    settings: {},
    schematics: [],
    pcbs: [],
    parts: [],
    nets: [],
    constraints: [],
    libraries: [],
    sourceMap: [],
    diagnostics: [],
    opaqueNodes: [],
    recognized: 0,
    normalized: 0,
    opaque: 0,
  };
  for (const input of inputs) {
    const text = new TextDecoder().decode(input.bytes);
    if (!/<eagle[\s>]/i.test(text)) continue;
    const asset = assets.find((a) => a.relativePath === input.path)!;
    const ref = sourceRef(asset.id, input.path);
    const root = child(xml(text), "eagle");
    const drawing = child(root, "drawing");
    const board = child(drawing, "board"),
      sch = child(drawing, "schematic");
    const base = stableId("eagle", input.path);
    out.projectName ??= withoutExtension(basename(input.path));
    out.sourceFormatVersion = root?.a.version;
    const libMap = new Map(
      kids(child(board || sch, "libraries"), "library").map((l) => [
        l.a.name,
        l,
      ]),
    );
    const partKey = (name: string) =>
      stableId("eagle-part", input.path.replace(/\.(sch|brd)$/i, ""), name);
    const makePart = (
      name: string,
      value: string,
      footprint: string,
      attributes: X[],
    ): PartIr => ({
      id: partKey(name),
      logicalPartKey: partKey(name),
      reference: name,
      value,
      footprint,
      fields: Object.fromEntries(attributes.map((a) => [a.a.name, a.a.value])),
      mpnRaw: attributes.find((a) =>
        /^(MPN|MANUFACTURER_PART_NUMBER)$/i.test(a.a.name),
      )?.a.value,
      manufacturerRaw: attributes.find((a) =>
        /^(MANUFACTURER|MFR)$/i.test(a.a.name),
      )?.a.value,
      symbolUnits: [],
      variantStatus: "fitted",
      pinPadMap: [],
      sourceRefs: [ref],
    });
    if (board) {
      const layerName = (n: string) =>
        ({
          "1": "F.Cu",
          "16": "B.Cu",
          "20": "Edge.Cuts",
          "21": "F.SilkS",
          "22": "B.SilkS",
          "51": "F.Fab",
          "52": "B.Fab",
        })[n] || `Eagle.${n}`;
      const layers = kids(child(drawing, "layers"), "layer").map((l) => ({
        id: l.a.number,
        sourceId: l.a.number,
        name: layerName(l.a.number),
        role: Number(l.a.number) <= 16 ? "copper" : "user",
        side: (l.a.number === "1"
          ? "front"
          : l.a.number === "16"
            ? "back"
            : "both") as "front" | "back" | "both",
        copper: Number(l.a.number) <= 16,
      }));
      const pcb: PcbIr = {
        id: base,
        documentId: base,
        name: basename(input.path),
        units: "mm",
        coordinateSystem: {
          sourceUnits: "mm",
          canonicalUnits: "mm",
          rotationConvention: "degrees_ccw",
          precision: "source_token_preserved",
        },
        layers,
        stackup: [],
        boardOutline: [],
        footprints: [],
        pads: [],
        tracks: [],
        vias: [],
        zones: [],
        sourceRefs: [ref],
      };
      const netForPad = new Map<string, NetIr>();
      for (const sig of kids(child(board, "signals"), "signal")) {
        const net: NetIr = {
          id: stableId(base, "net", sig.a.name),
          domain: "pcb_physical",
          canonicalName: sig.a.name,
          displayNames: [sig.a.name],
          endpoints: [],
          segmentIds: [],
          resolution: { method: "explicit", confidence: 1 },
          sourceRefs: [ref],
        };
        out.nets.push(net);
        for (const c of kids(sig, "contactref"))
          netForPad.set(c.a.element + ":" + c.a.pad, net);
        for (const w of kids(sig, "wire")) {
          const points = wirePoints(w);
          for (let i = 1; i < points.length; i++) {
            const id = stableId(base, "track", String(pcb.tracks.length));
            pcb.tracks.push({
              id,
              kind: "segment",
              start: points[i - 1],
              end: points[i],
              width: w.a.width,
              layer: layerName(w.a.layer),
              netId: net.id,
              sourceRef: ref,
            });
            net.segmentIds.push(id);
          }
        }
        for (const v of kids(sig, "via"))
          pcb.vias.push({
            id: stableId(base, "via", String(pcb.vias.length)),
            position: pt(num(v, "x"), num(v, "y")),
            size: v.a.diameter || String(num(v, "drill") * 2),
            drill: v.a.drill,
            layers: (v.a.extent || "1-16").split("-").map(layerName),
            netId: net.id,
            sourceRef: ref,
          });
        if (kids(sig, "polygon").length)
          out.diagnostics.push(
            diagnostic(
              "EAGLE_POLYGON_OUTLINE_ONLY",
              "Eagle copper pours are not filled by this viewer. Open the source board in Eagle for manufacturing checks.",
              "warning",
              "unsupported",
              ref,
            ),
          );
      }
      for (const el of kids(child(board, "elements"), "element")) {
        const lib = libMap.get(el.a.library),
          pkg = kids(child(lib, "packages"), "package").find(
            (p) => p.a.name === el.a.package,
          );
        const id = stableId(base, el.a.name);
        const rot = el.a.rot || "R0";
        const transform = (x: number, y: number) =>
          rotate(x, y, rot, num(el, "x"), num(el, "y"));
        const fp: PcbIr["footprints"][number] = {
          id,
          reference: el.a.name,
          value: el.a.value || "",
          libraryIdentifier: el.a.library + ":" + el.a.package,
          position: pt(num(el, "x"), num(el, "y")),
          rotation: String(Number(rot.replace(/[^0-9.-]/g, "")) || 0),
          side: rot.includes("M") ? "back" : "front",
          locked: el.a.locked === "yes",
          padIds: [],
          graphics: [],
          sourceRef: ref,
        };
        for (const p of [...kids(pkg, "smd"), ...kids(pkg, "pad")]) {
          const xy = transform(num(p, "x"), num(p, "y"));
          const padId = stableId(id, p.a.name),
            net = netForPad.get(el.a.name + ":" + p.a.name);
          const diameter = num(p, "diameter", num(p, "drill") * 2);
          const layer = rot.includes("M")
            ? p.a.layer === "1"
              ? "16"
              : p.a.layer === "16"
                ? "1"
                : p.a.layer
            : p.a.layer;
          pcb.pads.push({
            id: padId,
            footprintId: id,
            number: p.a.name,
            padType: p.name === "smd" ? "smd" : "thru_hole",
            shape:
              p.name === "smd"
                ? "rect"
                : p.a.shape === "square"
                  ? "rect"
                  : "circle",
            position: pt(xy.x, xy.y),
            rotation: String(
              (Number(rot.replace(/[^0-9.-]/g, "")) || 0) +
                (rot.includes("M") ? -1 : 1) *
                  (Number((p.a.rot || "").replace(/[^0-9.-]/g, "")) || 0),
            ),
            size: {
              x: String(num(p, "dx", diameter)),
              y: String(num(p, "dy", diameter)),
              unit: "mm",
            },
            drill: p.a.drill ? { x: p.a.drill, y: p.a.drill } : undefined,
            layers:
              p.name === "pad" ? ["F.Cu", "B.Cu"] : [layerName(layer || "1")],
            netId: net?.id,
            netName: net?.canonicalName,
            sourceRef: ref,
          });
          fp.padIds.push(padId);
          if (net)
            net.endpoints.push({
              id: padId + ":endpoint",
              type: "footprint_pad",
              targetId: padId,
              identifier: { reference: el.a.name, pad: p.a.name },
              position: pt(xy.x, xy.y),
            });
        }
        for (const w of kids(pkg, "wire")) {
          const points = wirePoints(w, (x, y) => ({
            x: rot.includes("M") ? -x : x,
            y,
          }));
          for (let i = 1; i < points.length; i++)
            fp.graphics!.push({
              id: stableId(id, "g", String(fp.graphics!.length)),
              layer: layerName(w.a.layer),
              kind: "line",
              geometry: { start: points[i - 1], end: points[i] },
            });
        }
        pcb.footprints.push(fp);
        if (!out.parts.some((p) => p.id === partKey(el.a.name)))
          out.parts.push(
            makePart(
              el.a.name,
              el.a.value || "",
              fp.libraryIdentifier,
              kids(el, "attribute"),
            ),
          );
        if (!pkg)
          out.diagnostics.push(
            diagnostic(
              "EAGLE_PACKAGE_MISSING",
              `Missing embedded package for ${el.a.name}.`,
              "warning",
              "library",
              ref,
            ),
          );
      }
      for (const w of kids(child(board, "plain"), "wire").filter(
        (w) => w.a.layer === "20",
      )) {
        const points = wirePoints(w);
        for (let i = 1; i < points.length; i++)
          pcb.boardOutline.push({
            id: stableId(base, "edge", String(pcb.boardOutline.length)),
            kind: "line",
            geometry: { start: points[i - 1], end: points[i] },
          });
      }
      for (const c of kids(child(board, "plain"), "circle").filter(
        (c) => c.a.layer === "20",
      )) {
        const center = pt(num(c, "x"), num(c, "y"));
        pcb.boardOutline.push({
          id: stableId(base, "circle", String(pcb.boardOutline.length)),
          kind: "circle",
          geometry: {
            center,
            end: pt(num(c, "x") + num(c, "radius"), num(c, "y")),
          },
        });
      }
      for (const h of kids(child(board, "plain"), "hole"))
        pcb.pads.push({
          id: stableId(base, "hole", String(pcb.pads.length)),
          number: "",
          padType: "np_thru_hole",
          shape: "circle",
          position: pt(num(h, "x"), num(h, "y")),
          size: { x: h.a.drill, y: h.a.drill, unit: "mm" },
          drill: { x: h.a.drill, y: h.a.drill },
          layers: ["*.Cu"],
          sourceRef: ref,
        });
      const edges = pcb.boardOutline
        .flatMap((e) => [e.geometry.start, e.geometry.end])
        .filter(Boolean) as IrPoint[];
      if (edges.length) {
        const xs = edges.map((p) => Number(p.x)),
          ys = edges.map((p) => Number(p.y));
        pcb.physicalDimensions = {
          width: String(Math.max(...xs) - Math.min(...xs)),
          height: String(Math.max(...ys) - Math.min(...ys)),
          unit: "mm",
          boundingBox: {
            minX: String(Math.min(...xs)),
            maxX: String(Math.max(...xs)),
            minY: String(Math.min(...ys)),
            maxY: String(Math.max(...ys)),
          },
          outlineClosed: edges.every((p, i) =>
            edges.some(
              (q, j) =>
                i !== j &&
                Math.hypot(
                  Number(p.x) - Number(q.x),
                  Number(p.y) - Number(q.y),
                ) < 0.001,
            ),
          ),
        };
      }
      out.pcbs.push(pcb);
      out.diagnostics.push(
        diagnostic(
          "EAGLE_3D_MODELS",
          "Eagle XML does not include component STEP models. The 3D view shows board geometry; supply a board assembly STEP to view the full assembly.",
          "information",
          "library",
          ref,
        ),
      );
    }
    if (sch) {
      const parts = new Map(
        kids(child(sch, "parts"), "part").map((p) => [p.a.name, p]),
      );
      let sheetNo = 0;
      for (const sheet of kids(child(sch, "sheets"), "sheet")) {
        sheetNo++;
        const sid = stableId(base, String(sheetNo));
        const s: SchematicIr = {
          id: sid,
          documentId: sid,
          name: `${basename(input.path)} · Sheet ${sheetNo}`,
          rootSheetId: sid,
          sheets: [{ id: sid, name: String(sheetNo), instancePath: "/" }],
          texts: [],
          graphics: [],
          symbolInstanceIds: [],
          pins: [],
          wires: [],
          junctions: [],
          labels: [],
          noConnects: [],
          connectivityGraphId: sid,
          sourceRefs: [ref],
        };
        for (const ins of kids(child(sheet, "instances"), "instance")) {
          const p = parts.get(ins.a.part);
          if (!p) continue;
          const lib = libMap.get(p.a.library),
            ds = kids(child(lib, "devicesets"), "deviceset").find(
              (x) => x.a.name === p.a.deviceset,
            ),
            gate = kids(child(ds, "gates"), "gate").find(
              (x) => x.a.name === ins.a.gate,
            ),
            sym = kids(child(lib, "symbols"), "symbol").find(
              (x) => x.a.name === gate?.a.symbol,
            ),
            device = kids(child(ds, "devices"), "device").find(
              (x) => x.a.name === (p.a.device || ""),
            );
          let part = out.parts.find((x) => x.id === partKey(p.a.name));
          if (!part) {
            part = makePart(
              p.a.name,
              p.a.value || p.a.deviceset,
              device?.a.package || "",
              kids(p, "attribute"),
            );
            out.parts.push(part);
          } else {
            const extra = makePart(
              p.a.name,
              p.a.value || p.a.deviceset,
              device?.a.package || "",
              kids(p, "attribute"),
            );
            part.mpnRaw ||= extra.mpnRaw;
            part.manufacturerRaw ||= extra.manufacturerRaw;
            part.fields = { ...part.fields, ...extra.fields };
          }
          const uid = stableId(sid, p.a.name, ins.a.gate);
          const transform = (x: number, y: number) =>
            rotate(x, y, ins.a.rot, num(ins, "x"), num(ins, "y"));
          part.symbolUnits.push({
            id: uid,
            unit: part.symbolUnits.length + 1,
            position: pt(num(ins, "x"), num(ins, "y")),
            rotation: ins.a.rot,
          });
          s.symbolInstanceIds.push(uid);
          for (const rect of kids(sym, "rectangle")) {
            const pts = [
              [num(rect, "x1"), num(rect, "y1")],
              [num(rect, "x2"), num(rect, "y1")],
              [num(rect, "x2"), num(rect, "y2")],
              [num(rect, "x1"), num(rect, "y2")],
            ].map(([x, y]) => {
              const t = transform(x, y);
              return pt(t.x, t.y);
            });
            s.graphics!.push({
              id: stableId(uid, "rectangle", String(s.graphics!.length)),
              symbolUnitId: uid,
              points: pts,
              closed: true,
            });
          }
          for (const circle of kids(sym, "circle")) {
            const pts = Array.from({ length: 48 }, (_, i) => {
              const a = (i * Math.PI) / 24;
              const t = transform(
                num(circle, "x") + num(circle, "radius") * Math.cos(a),
                num(circle, "y") + num(circle, "radius") * Math.sin(a),
              );
              return pt(t.x, t.y);
            });
            s.graphics!.push({
              id: stableId(uid, "circle", String(s.graphics!.length)),
              symbolUnitId: uid,
              points: pts,
              closed: true,
            });
          }
          for (const w of kids(sym, "wire"))
            s.graphics!.push({
              id: stableId(uid, "g", String(s.graphics!.length)),
              symbolUnitId: uid,
              points: wirePoints(w, transform),
              closed: false,
            });
          for (const pin of kids(sym, "pin")) {
            const xy = transform(num(pin, "x"), num(pin, "y"));
            const length =
              (
                { point: 0, short: 2.54, middle: 5.08, long: 7.62 } as Record<
                  string,
                  number
                >
              )[pin.a.length || "long"] ?? 7.62;
            const end = rotate(
              length,
              0,
              pin.a.rot,
              num(pin, "x"),
              num(pin, "y"),
            );
            const ep = transform(end.x, end.y);
            if (length)
              s.graphics!.push({
                id: stableId(uid, pin.a.name, "line"),
                symbolUnitId: uid,
                points: [pt(xy.x, xy.y), pt(ep.x, ep.y)],
                closed: false,
              });
            const conn = kids(child(device, "connects"), "connect").find(
              (c) => c.a.gate === ins.a.gate && c.a.pin === pin.a.name,
            );
            s.pins.push({
              id: stableId(uid, pin.a.name),
              partId: part.id,
              symbolUnitId: uid,
              reference: p.a.name,
              number: conn?.a.pad || pin.a.name,
              name: pin.a.name,
              position: pt(xy.x, xy.y),
              sourceRef: ref,
            });
          }
          for (const t of kids(sym, "text")) {
            const xy = transform(num(t, "x"), num(t, "y"));
            s.texts!.push({
              id: stableId(uid, "t", String(s.texts!.length)),
              symbolUnitId: uid,
              text:
                t.text === ">NAME"
                  ? p.a.name
                  : t.text === ">VALUE"
                    ? part.value
                    : t.text,
              kind:
                t.text === ">NAME"
                  ? "Reference"
                  : t.text === ">VALUE"
                    ? "Value"
                    : "text",
              position: pt(xy.x, xy.y),
              rotation: "0",
              size: t.a.size || "1.27",
              align: "start",
            });
          }
          if (!sym)
            out.diagnostics.push(
              diagnostic(
                "EAGLE_SYMBOL_MISSING",
                `Missing embedded symbol for ${p.a.name}.`,
                "warning",
                "library",
                ref,
              ),
            );
        }
        for (const n of kids(child(sheet, "nets"), "net")) {
          const net: NetIr = {
            id: stableId(base, "logical", n.a.name),
            domain: "schematic_logical",
            canonicalName: n.a.name,
            displayNames: [n.a.name],
            endpoints: [],
            segmentIds: [],
            resolution: { method: "explicit", confidence: 1 },
            sourceRefs: [ref],
          };
          for (const seg of kids(n, "segment")) {
            for (const w of kids(seg, "wire")) {
              const id = stableId(sid, "wire", String(s.wires.length));
              s.wires.push({ id, points: wirePoints(w), sourceRef: ref });
              net.segmentIds.push(id);
            }
            for (const j of kids(seg, "junction"))
              s.junctions.push({
                id: stableId(sid, "j", String(s.junctions.length)),
                position: pt(num(j, "x"), num(j, "y")),
                sourceRef: ref,
              });
            for (const l of kids(seg, "label"))
              s.labels.push({
                id: stableId(sid, "l", String(s.labels.length)),
                name: n.a.name,
                kind: "local",
                position: pt(num(l, "x"), num(l, "y")),
                sourceRef: ref,
              });
            for (const pr of kids(seg, "pinref")) {
              const uid = stableId(sid, pr.a.part, pr.a.gate);
              const pin = s.pins.find(
                (p) => p.symbolUnitId === uid && p.name === pr.a.pin,
              );
              if (pin)
                net.endpoints.push({
                  id: pin.id + ":endpoint",
                  type: "symbol_pin",
                  targetId: pin.id,
                  identifier: {
                    partId: pin.partId,
                    reference: pin.reference,
                    pin: pin.number,
                  },
                  position: pin.position,
                });
            }
          }
          const existing = out.nets.find((x) => x.id === net.id);
          if (existing) {
            existing.endpoints.push(...net.endpoints);
            existing.segmentIds.push(...net.segmentIds);
          } else out.nets.push(net);
        }
        out.schematics.push(s);
      }
    }
    out.sourceMap.push(ref);
  }
  out.recognized = out.parts.length + out.nets.length;
  out.normalized = out.recognized;
  return out;
}
