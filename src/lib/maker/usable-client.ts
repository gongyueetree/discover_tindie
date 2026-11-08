"use client";
/**
 * Whether a design's repository can be opened, asked once per design per page load. Cards that come
 * into view together are asked in one request (POST /api/maker/circuits/usable, up to 48 at a time)
 * instead of one request each.
 */
const usableChecks = new Map<string, Promise<boolean | null>>();
let waiting: { id: string; resolve: (v: boolean | null) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const batch = waiting.splice(0, 48);
  if (waiting.length) timer = setTimeout(flush, 0);
  if (!batch.length) return;
  fetch("/api/maker/circuits/usable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: batch.map((b) => b.id) }),
  })
    .then((r) => (r.ok ? r.json() : { usable: {} }))
    .catch(() => ({ usable: {} }))
    .then((x: { usable?: Record<string, unknown> }) => {
      for (const b of batch) {
        const v = x.usable?.[b.id];
        b.resolve(typeof v === "boolean" ? v : null);
      }
    });
}

export function checkUsable(id: string) {
  let p = usableChecks.get(id);
  if (!p) {
    p = new Promise<boolean | null>((resolve) => {
      waiting.push({ id, resolve });
      if (!timer) timer = setTimeout(flush, 60);
    });
    usableChecks.set(id, p);
  }
  return p;
}
