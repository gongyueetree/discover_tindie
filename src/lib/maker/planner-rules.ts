import type {
  BoardDefinition,
  CircuitCanvasDocument,
  PlacedComponent,
} from "@/vendor/protopcb/design-core/document/types";
import { holeKeepouts } from "@/vendor/protopcb/design-core/collision";
import { padFootprintFor } from "@/vendor/protopcb/design-core/geometry/footprint-pads";
export function componentExtentRect(c: PlacedComponent) {
  const fp = padFootprintFor(c.footprint.name),
    g = c.footprint.geometry;
  const boxes = [
    {
      x: fp?.bodyCx || 0,
      y: fp?.bodyCy || 0,
      w: fp?.bodyW || g.bodyWidthMm,
      h: fp?.bodyH || g.bodyHeightMm,
    },
    ...(fp?.pads || []),
  ];
  const a = (c.placement.rotation * Math.PI) / 180;
  const pts = boxes.flatMap((b) =>
    [-1, 1].flatMap((s) =>
      [-1, 1].map((t) => {
        const x = b.x + (s * b.w) / 2,
          y = (b.y + (t * b.h) / 2) * (c.placement.side === "BOTTOM" ? -1 : 1);
        return {
          x: c.placement.xMm + x * Math.cos(a) - y * Math.sin(a),
          y: c.placement.yMm + x * Math.sin(a) + y * Math.cos(a),
        };
      }),
    ),
  );
  const xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}
export function placementIssue(
  c: PlacedComponent,
  others: PlacedComponent[],
  board: BoardDefinition,
  gap = 0.5,
): string | null {
  const p = c.placement;
  if (![p.xMm, p.yMm, p.rotation].every(Number.isFinite))
    return "Coordinates must be finite numbers.";
  const r = componentExtentRect(c);
  if (
    r.x < 0.5 ||
    r.y < 0.5 ||
    r.x + r.width > board.widthMm - 0.5 ||
    r.y + r.height > board.heightMm - 0.5
  )
    return "The whole footprint must remain inside the board edge (0.5 mm margin).";
  if (
    holeKeepouts(board).some((h) => {
      const x = Math.max(r.x, Math.min(h.x, r.x + r.width));
      const y = Math.max(r.y, Math.min(h.y, r.y + r.height));
      return (x - h.x) ** 2 + (y - h.y) ** 2 < h.r ** 2;
    })
  )
    return "The footprint intersects a mounting-hole keepout.";
  for (const o of others) {
    if (o.instanceId === c.instanceId) continue;
    const b = componentExtentRect(o);
    if (
      r.x < b.x + b.width + gap &&
      r.x + r.width + gap > b.x &&
      r.y < b.y + b.height + gap &&
      r.y + r.height + gap > b.y
    )
      return `Maintain ${gap} mm clearance from ${o.reference}.`;
  }
  return null;
}
export function placeFree(
  c: PlacedComponent,
  others: PlacedComponent[],
  board: BoardDefinition,
  gap = 0.5,
) {
  const origin = { ...c, placement: { ...c.placement, xMm: 0, yMm: 0 } };
  const shape = componentExtentRect(origin);
  const boxes = others
    .filter((o) => o.instanceId !== c.instanceId)
    .map(componentExtentRect);
  const holes = holeKeepouts(board);
  let best: PlacedComponent | null = null,
    bestScore = -Infinity,
    bestCenter = Infinity;
  const step = 1;
  const xs = [board.widthMm / 2 - shape.x - shape.width / 2];
  const ys = [board.heightMm / 2 - shape.y - shape.height / 2];
  for (
    let x = 0.5 - shape.x;
    x <= board.widthMm - 0.5 - shape.x - shape.width;
    x += step
  )
    xs.push(x);
  for (
    let y = 0.5 - shape.y;
    y <= board.heightMm - 0.5 - shape.y - shape.height;
    y += step
  )
    ys.push(y);
  for (const x of xs)
    for (const y of ys) {
      const left = x + shape.x,
        top = y + shape.y,
        right = left + shape.width,
        bottom = top + shape.height;
      let score = Math.min(
        left - 0.5,
        top - 0.5,
        board.widthMm - 0.5 - right,
        board.heightMm - 0.5 - bottom,
      );
      if (score < 0) continue;
      let valid = true;
      for (const b of boxes) {
        const dx = Math.max(b.x - right, left - b.x - b.width),
          dy = Math.max(b.y - bottom, top - b.y - b.height);
        if (dx < gap && dy < gap) {
          valid = false;
          break;
        }
        score = Math.min(
          score,
          Math.hypot(Math.max(0, dx - gap), Math.max(0, dy - gap)),
        );
      }
      if (!valid) continue;
      for (const h of holes) {
        const distance =
          Math.hypot(
            h.x - Math.max(left, Math.min(h.x, right)),
            h.y - Math.max(top, Math.min(h.y, bottom)),
          ) - h.r;
        if (distance < 0) {
          valid = false;
          break;
        }
        score = Math.min(score, distance);
      }
      if (!valid) continue;
      const center = Math.hypot(
        left + shape.width / 2 - board.widthMm / 2,
        top + shape.height / 2 - board.heightMm / 2,
      );
      if (
        score > bestScore + 1e-8 ||
        (Math.abs(score - bestScore) < 1e-8 && center < bestCenter)
      ) {
        bestScore = score;
        bestCenter = center;
        best = { ...c, placement: { ...c.placement, xMm: x, yMm: y } };
      }
    }
  return best && !placementIssue(best, others, board, gap) ? best : null;
}
export function validateLayout(d: CircuitCanvasDocument, gap = 0.5) {
  if (
    ![d.board.widthMm, d.board.heightMm].every(
      (n) => Number.isFinite(n) && n >= 20 && n <= 300,
    )
  )
    return "Board dimensions must be between 20 and 300 mm.";
  if (d.board.shape !== "rect")
    return "This planner currently supports rectangular boards.";
  for (const c of d.components) {
    const issue = placementIssue(c, d.components, d.board, gap);
    if (issue) return `${c.reference}: ${issue}`;
  }
  return null;
}
export const categoryLabels = {
  mcu: "Processing",
  power: "Power supply",
  passive: "Passive components",
  connector: "Interfaces",
  ic: "Integrated circuits",
  electromech: "Electromechanical",
  sensor: "Sensing",
  rf: "RF and wireless",
};
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function blockDiagram(d: CircuitCanvasDocument) {
  const groups = Object.entries(categoryLabels).flatMap(([key, label]) => {
    const c = d.components.filter((c) => c.category === key);
    return c.length ? [{ label, c }] : [];
  });
  const height = 100 + Math.ceil(groups.length / 2) * 150;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}"><rect width="100%" height="100%" fill="#f6fafb"/><text x="30" y="32" font-size="22" font-family="Arial" fill="#24454f">${escape(d.name)} · Functional blocks</text><text x="30" y="57" font-size="13" font-family="Arial" fill="#617c85">Grouped by component category. Electrical connections are not inferred.</text>${groups
    .map(
      (g, i) =>
        `<g transform="translate(${30 + (i % 2) * 480},${85 + Math.floor(i / 2) * 150})"><rect width="450" height="130" rx="10" fill="#e7f6f7" stroke="#18a3b2"/><text x="18" y="28" font-family="Arial" font-size="18" fill="#24454f">${g.label} · ${g.c.length} parts</text>${g.c
          .map((c) => c.reference + ": " + (c.mpn || c.footprint.name))
          .slice(0, 3)
          .map(
            (t, j) =>
              `<text x="18" y="${53 + j * 20}" font-family="Arial" font-size="12" fill="#24454f">${escape(t.slice(0, 58))}</text>`,
          )
          .join(
            "",
          )}${g.c.length > 3 ? `<text x="18" y="118" font-family="Arial" font-size="11">+ ${g.c.length - 3} more (see BOM)</text>` : ""}</g>`,
    )
    .join("")}</svg>`;
}
