"use client";
const usableChecks = new Map<string, Promise<boolean | null>>();
/** Asks the server once per design (per page load) whether its repository can be opened. */
export function checkUsable(id: string) {
  let p = usableChecks.get(id);
  if (!p) {
    p = fetch(`/api/maker/circuits/${encodeURIComponent(id)}/usable`)
      .then((r) => (r.ok ? r.json() : { usable: null }))
      .then((x) => (typeof x.usable === "boolean" ? x.usable : null))
      .catch(() => null);
    usableChecks.set(id, p);
  }
  return p;
}

