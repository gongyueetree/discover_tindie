// Client-side section analytics. Events are queued and flushed together so a
// page load sends ~1 request instead of one per section. Fire-and-forget:
// failures are swallowed and never affect the visitor.
import type { TrackKind } from "@/lib/sections";

type Ev = { section: string; kind: TrackKind };

let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (queue.length === 0 || typeof window === "undefined") return;
  const events = queue;
  queue = [];
  const body = JSON.stringify({ events });
  try {
    // sendBeacon survives page unload; fall back to keepalive fetch.
    if (navigator.sendBeacon && navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall through to fetch */ }
  fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
}

// Per-item event (discovery read / resource click). Sent immediately —
// fire-and-forget, best-effort, never blocks navigation.
export function trackItem(type: "discovery" | "resource", id: number) {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ type, id });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon("/api/track/item", new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall through */ }
  fetch("/api/track/item", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
}

export function track(section: string, kind: TrackKind) {
  if (typeof window === "undefined") return;
  queue.push({ section, kind });
  // Clicks flush promptly (the user may navigate away); views can batch.
  if (kind === "click") { flush(); return; }
  if (!timer) timer = setTimeout(flush, 800);
}

// Make sure queued views aren't lost when the tab is hidden or closed.
if (typeof window !== "undefined") {
  const onHide = () => flush();
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") onHide(); });
}

