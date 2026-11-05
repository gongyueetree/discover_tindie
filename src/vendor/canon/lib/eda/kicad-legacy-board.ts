// @ts-nocheck — vendored from canon-eda-ir-agent (REFIR); see ../NOTICE.md. Typed access goes through ../core-api.ts.
/**
 * KiCad's legacy board (`.brd`, "PCBNEW-BOARD Version 1/2": KiCad 2007–2013,
 * before the S-expression `.kicad_pcb`) rewritten as the `.kicad_pcb` KiCad 4
 * itself makes of it when it opens one, so it is read by the same board parser
 * (local addition: ../../NOTICE.md). Follows KiCad's legacy_plugin.cpp: version 1
 * is in 1/10000 inch, version 2 says `Units mm`; angles are in 0.1°; legacy layer
 * numbers (0 back copper … 15 front copper, 16–28 technical) are mapped to their
 * KiCad 4 names. Dimensions and targets are left out.
 */

const TECHNICAL = ["B.Adhes", "F.Adhes", "B.Paste", "F.Paste", "B.SilkS", "F.SilkS", "B.Mask", "F.Mask", "Dwgs.User", "Cmts.User", "Eco1.User", "Eco2.User", "Edge.Cuts"];

export const isLegacyKicadBoard = (text: string) => /^\s*PCBNEW-BOARD Version \d/.test(text);

/** The `.kicad_pcb` text of a legacy board, or undefined when the text is not one. */
export function legacyBoardToKicadPcb(text: string): string | undefined {
  if (!isLegacyKicadBoard(text)) return undefined;
  const lines = text.split(/\r?\n/);
  const mm = /^Units\s+mm\b/m.test(text.slice(0, 4000));
  const scale = mm ? 1 : 0.00254;
  const n = (value: string | undefined) => {
    const v = Number(value) * scale;
    return Number.isFinite(v) ? String(Number(v.toFixed(6))) : "0";
  };
  const deg = (value: string | undefined) => {
    const v = Number(value) / 10;
    return Number.isFinite(v) ? String(Number(v.toFixed(3))) : "0";
  };
  const q = (s: string) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const quoted = (line: string) => line.match(/"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
  const general = text.slice(0, 6000);
  const copperCount = Math.max(1, Number(general.match(/^LayerCount\s+(\d+)/m)?.[1] ?? 2));
  /** A legacy layer number by its KiCad 4 name (legacy_plugin.cpp leg_layer2new). */
  const layer = (value: string | number): string => {
    const id = Number(value);
    if (id === 15) return "F.Cu";
    if (id === 0) return copperCount > 1 ? "B.Cu" : "F.Cu";
    if (id > 0 && id < 15) return `In${Math.max(1, copperCount - 1 - id)}.Cu`;
    return TECHNICAL[id - 16] ?? "Dwgs.User";
  };
  /** A pad's layer mask (hex): bit n is legacy layer n. */
  const maskLayers = (hex: string | undefined): string[] => {
    const mask = parseInt(hex ?? "0", 16) >>> 0;
    const bits = new Set<number>();
    for (let i = 0; i < 29; i++) if (mask & (1 << i)) bits.add(i);
    const copper = [...bits].filter((b) => b < 16);
    const out: string[] = [];
    if (copper.length >= Math.min(copperCount, 2) && copper.includes(0) && copper.includes(15)) out.push("*.Cu");
    else out.push(...copper.map(layer));
    if (bits.has(22) && bits.has(23)) out.push("*.Mask");
    else for (const b of [22, 23]) if (bits.has(b)) out.push(layer(b));
    for (const b of bits) if (b >= 16 && b !== 22 && b !== 23) out.push(layer(b));
    return [...new Set(out)];
  };

  const nets = new Map<string, string>([["0", ""]]);
  const out: string[] = [];
  let thickness = "1.6";
  let viaDrill = n(mm ? "0.4" : "157");
  let i = 0;
  const next = () => lines[i++] ?? "";
  const words = (line: string) => line.trim().split(/\s+/);

  const text3 = (kind: string, value: string, x: string, y: string, angle: string, sizeY: string, sizeX: string, thick: string, layerName: string, hidden: boolean, mirrored: boolean) =>
    `(${kind} ${q(value)} (at ${x} ${y}${angle !== "0" ? " " + angle : ""}) (layer ${layerName})${hidden ? " hide" : ""} (effects (font (size ${sizeY} ${sizeX}) (thickness ${thick}))${mirrored ? " (justify mirror)" : ""}))`;

  function readModule(header: string) {
    const name = header.replace(/^\$MODULE\s*/, "").trim();
    const parts: string[] = [];
    let at = ["0", "0", "0"], side = "F.Cu";
    for (;;) {
      if (i >= lines.length) break;
      const line = next();
      const w = words(line);
      if (w[0] === "$EndMODULE") break;
      if (w[0] === "Po") {
        at = [n(w[1]), n(w[2]), deg(w[3])];
        side = Number(w[4]) === 0 ? "B.Cu" : "F.Cu";
      } else if (/^T\d+$/.test(w[0])) {
        // T<n> x y size_y size_x angle thickness N|M V|I layer N|I "text"
        const kind = w[0] === "T0" ? "reference" : w[0] === "T1" ? "value" : "user";
        parts.push(text3(`fp_text ${kind}`, quoted(line), n(w[1]), n(w[2]), deg(w[5]), n(w[3]), n(w[4]), n(w[6]), layer(w[9]), w[8] === "I", w[7] === "M"));
      } else if (w[0] === "DS") {
        parts.push(`(fp_line (start ${n(w[1])} ${n(w[2])}) (end ${n(w[3])} ${n(w[4])}) (layer ${layer(w[6])}) (width ${n(w[5])}))`);
      } else if (w[0] === "DC") {
        parts.push(`(fp_circle (center ${n(w[1])} ${n(w[2])}) (end ${n(w[3])} ${n(w[4])}) (layer ${layer(w[6])}) (width ${n(w[5])}))`);
      } else if (w[0] === "DA") {
        parts.push(`(fp_arc (start ${n(w[1])} ${n(w[2])}) (end ${n(w[3])} ${n(w[4])}) (angle ${deg(w[5])}) (layer ${layer(w[7])}) (width ${n(w[6])}))`);
      } else if (w[0] === "DP") {
        // DP 0 0 0 0 <corners> <width> <layer>, then one `Dl x y` per corner.
        const count = Number(w[5]), pts: string[] = [];
        for (let k = 0; k < count && i < lines.length; k++) {
          const p = words(next());
          if (p[0] !== "Dl") { i--; break; }
          pts.push(`(xy ${n(p[1])} ${n(p[2])})`);
        }
        if (pts.length >= 3) parts.push(`(fp_poly (pts ${pts.join(" ")}) (layer ${layer(w[7])}) (width ${n(w[6])}))`);
      } else if (w[0] === "$PAD") {
        let number = "", shape = "circle", size = ["0", "0"], angle = "0", drill = "", type = "thru_hole", padLayers: string[] = [], net = "", pos = ["0", "0"], delta = "";
        for (;;) {
          if (i >= lines.length) break;
          const pl = next();
          const p = words(pl);
          if (p[0] === "$EndPAD") break;
          if (p[0] === "Sh") {
            number = quoted(pl);
            const rest = words(pl.slice(pl.lastIndexOf('"') + 1));
            shape = { C: "circle", R: "rect", O: "oval", T: "trapezoid" }[rest[0]] ?? "rect";
            size = [n(rest[1]), n(rest[2])];
            if (shape === "trapezoid" && (Number(rest[3]) || Number(rest[4]))) delta = ` (rect_delta ${n(rest[4])} ${n(rest[3])})`;
            angle = deg(rest[5]);
          } else if (p[0] === "Dr") {
            // Dr <diameter> <offset x> <offset y> [O <w> <h>]
            const offset = Number(p[2]) || Number(p[3]) ? ` (offset ${n(p[2])} ${n(p[3])})` : "";
            if (p[4] === "O" && (Number(p[5]) || Number(p[6]))) drill = ` (drill oval ${n(p[5])} ${n(p[6])}${offset})`;
            else if (Number(p[1])) drill = ` (drill ${n(p[1])}${offset})`;
          } else if (p[0] === "At") {
            type = { STD: "thru_hole", SMD: "smd", CONN: "connect", HOLE: "np_thru_hole" }[p[1]] ?? "thru_hole";
            padLayers = maskLayers(p[3]);
          } else if (p[0] === "Ne") {
            const code = p[1];
            net = code && code !== "0" ? ` (net ${code} ${q(quoted(pl) || nets.get(code) || "")})` : "";
          } else if (p[0] === "Po") pos = [n(p[1]), n(p[2])];
        }
        parts.push(`(pad ${q(number)} ${type} ${shape} (at ${pos[0]} ${pos[1]}${angle !== "0" ? " " + angle : ""}) (size ${size[0]} ${size[1]})${delta}${drill} (layers ${padLayers.join(" ") || "F.Cu"})${net})`);
      } else if (w[0] === "$SHAPE3D") {
        let path = "", sc = "1 1 1", of = "0 0 0", ro = "0 0 0";
        for (;;) {
          if (i >= lines.length) break;
          const sl = next();
          const s = words(sl);
          if (s[0] === "$EndSHAPE3D") break;
          if (s[0] === "Na") path = quoted(sl);
          else if (s[0] === "Sc") sc = s.slice(1, 4).join(" ");
          else if (s[0] === "Of") of = s.slice(1, 4).join(" ");
          else if (s[0] === "Ro") ro = s.slice(1, 4).join(" ");
        }
        if (path) parts.push(`(model ${q(path)} (at (xyz ${of})) (scale (xyz ${sc})) (rotate (xyz ${ro})))`);
      }
    }
    out.push(`(module ${q(name)} (layer ${side}) (at ${at[0]} ${at[1]}${at[2] !== "0" ? " " + at[2] : ""})\n  ${parts.join("\n  ")})`);
  }

  function readTracks(end: string, zoneFill: boolean) {
    for (;;) {
      if (i >= lines.length) break;
      const po = words(next());
      if (po[0] === end) break;
      if (po[0] !== "Po") continue;
      const de = words(next());
      // Po <shape> x1 y1 x2 y2 width [drill]; De <layer> <type 0 track | 1 via> <net> …
      const net = de[3] && de[3] !== "0" ? ` (net ${de[3]})` : "";
      if (de[2] === "1" && !zoneFill) {
        const drill = po[7] !== undefined && Number(po[7]) > 0 ? n(po[7]) : viaDrill;
        out.push(`(via (at ${n(po[2])} ${n(po[3])}) (size ${n(po[6])}) (drill ${drill}) (layers F.Cu B.Cu)${net})`);
      } else {
        out.push(`(segment (start ${n(po[2])} ${n(po[3])}) (end ${n(po[4])} ${n(po[5])}) (width ${n(po[6])}) (layer ${layer(de[1])})${net})`);
      }
    }
  }

  function readZone() {
    let net = "0", name = "", zoneLayer = "F.Cu";
    const corners: string[] = [], fills: string[][] = [[]];
    for (;;) {
      if (i >= lines.length) break;
      const zl = next();
      const z = words(zl);
      if (z[0] === "$endCZONE_OUTLINE" || z[0] === "$EndCZONE_OUTLINE") break;
      if (z[0] === "ZInfo") { net = z[2] ?? "0"; name = quoted(zl); }
      else if (z[0] === "ZLayer") zoneLayer = layer(z[1]);
      else if (z[0] === "ZCorner") corners.push(`(xy ${n(z[1])} ${n(z[2])})`);
      else if (z[0] === "$POLYSCORNERS") {
        for (;;) {
          if (i >= lines.length) break;
          const c = words(next());
          if (/^\$end/i.test(c[0])) break;
          fills[fills.length - 1].push(`(xy ${n(c[0])} ${n(c[1])})`);
          if (c[2] === "1") fills.push([]);
        }
      } else if (z[0] === "$FILLSEGMENTS") {
        while (i < lines.length && !/^\$end/i.test(words(next())[0])) { /* fill strokes: the polygons above already cover them */ }
      }
    }
    const filled = fills.filter((f) => f.length >= 3).map((f) => `(filled_polygon (pts ${f.join(" ")}))`).join(" ");
    if (corners.length >= 3) out.push(`(zone (net ${net}) (net_name ${q(name)}) (layer ${zoneLayer}) (polygon (pts ${corners.join(" ")})) ${filled})`);
  }

  while (i < lines.length) {
    const line = next();
    const w = words(line);
    switch (w[0]) {
      case "BoardThickness":
        thickness = n(w[1]);
        break;
      case "ViaDrill":
        viaDrill = n(w[1]);
        break;
      case "$EQUIPOT":
        for (;;) {
          if (i >= lines.length) break;
          const e = next();
          if (e.startsWith("$EndEQUIPOT")) break;
          const m = e.match(/^Na\s+(\d+)\s+"((?:[^"\\]|\\.)*)"/);
          if (m) nets.set(m[1], m[2]);
        }
        break;
      case "$MODULE":
        readModule(line);
        break;
      case "$DRAWSEGMENT": {
        let po: string[] = [], de: string[] = [];
        for (;;) {
          if (i >= lines.length) break;
          const d = words(next());
          if (d[0] === "$EndDRAWSEGMENT") break;
          if (d[0] === "Po") po = d;
          else if (d[0] === "De") de = d;
        }
        // Po <shape 0 line, 1 rect, 2 arc, 3 circle> x1 y1 x2 y2 width; De <layer> <type> <arc angle> …
        const lay = layer(de[1] ?? 24), width = n(po[6]);
        if (po[1] === "2") out.push(`(gr_arc (start ${n(po[2])} ${n(po[3])}) (end ${n(po[4])} ${n(po[5])}) (angle ${deg(de[3])}) (layer ${lay}) (width ${width}))`);
        else if (po[1] === "3") out.push(`(gr_circle (center ${n(po[2])} ${n(po[3])}) (end ${n(po[4])} ${n(po[5])}) (layer ${lay}) (width ${width}))`);
        else if (po.length >= 6) out.push(`(gr_line (start ${n(po[2])} ${n(po[3])}) (end ${n(po[4])} ${n(po[5])}) (layer ${lay}) (width ${width}))`);
        break;
      }
      case "$TEXTPCB": {
        let value = "", po: string[] = [], de: string[] = [];
        for (;;) {
          if (i >= lines.length) break;
          const tl = next();
          const t = words(tl);
          if (t[0] === "$EndTEXTPCB") break;
          if (t[0] === "Te") value = quoted(tl).replace(/\\n/g, "\n");
          else if (t[0] === "nl") value += "\n" + quoted(tl);
          else if (t[0] === "Po") po = t;
          else if (t[0] === "De") de = t;
        }
        // Po x y size_x size_y thickness angle; De <layer> <1 normal | 0 mirrored> …
        if (value && po.length >= 7) out.push(text3("gr_text", value, n(po[1]), n(po[2]), deg(po[6]), n(po[4]), n(po[3]), n(po[5]), layer(de[1] ?? 21), false, de[2] === "0"));
        break;
      }
      case "$TRACK":
        readTracks("$EndTRACK", false);
        break;
      case "$ZONE":
        // Old-style zone fill: track segments.
        readTracks("$EndZONE", true);
        break;
      case "$CZONE_OUTLINE":
        readZone();
        break;
      default:
        break;
    }
  }

  const copper = ["(0 F.Cu signal)"];
  for (let k = 1; k < copperCount - 1; k++) copper.push(`(${k} In${k}.Cu signal)`);
  if (copperCount > 1) copper.push("(31 B.Cu signal)");
  const technical = TECHNICAL.map((name, k) => `(${32 + k} ${name} user)`);
  const header = [
    `(kicad_pcb (version 4) (host pcbnew ${q("legacy " + lines[0].trim())})`,
    `(general (thickness ${thickness}))`,
    `(layers ${copper.join(" ")} ${technical.join(" ")})`,
    ...[...nets].map(([code, name]) => `(net ${code} ${q(name)})`),
  ];
  return header.join("\n") + "\n" + out.join("\n") + "\n)\n";
}
