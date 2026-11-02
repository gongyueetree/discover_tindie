// The home-page sections tracked for view/click analytics. Shared by the
// tracking endpoint (whitelist validation), the client instrumentation, and
// the admin dashboard chart (labels + line colors). Pure data — no imports —
// so it is safe in both server and client bundles.
export type TrackSection = { id: string; label: string; color: string };

export const TRACK_SECTIONS: TrackSection[] = [
  { id: "recommendation", label: "Recommendation", color: "#22b8c4" },
  { id: "featured",       label: "Featured",       color: "#7a5cff" },
  { id: "discoveries",    label: "Discoveries",    color: "#f2762e" },
  { id: "blog",           label: "Blog",           color: "#4a6fd4" },
  { id: "directory",      label: "Directory",      color: "#3ea76a" },
];

export const TRACK_SECTION_IDS = TRACK_SECTIONS.map((s) => s.id);
export const TRACK_KINDS = ["view", "click"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

export function isTrackSection(x: unknown): x is string {
  return typeof x === "string" && TRACK_SECTION_IDS.includes(x);
}
export function isTrackKind(x: unknown): x is TrackKind {
  return x === "view" || x === "click";
}

