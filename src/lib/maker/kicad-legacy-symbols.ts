import "server-only";
/**
 * Standard KiCad symbols for KiCad 4/5 projects that were published without their symbol cache
 * (`<project>-cache.lib`): without it a schematic has no bodies for R, C, GND, connectors… and the
 * viewer could only draw bare pins.
 *
 * KiCad 4 → the official library repository at its last 4.x release (KiCad/kicad-library 4.0.7);
 * KiCad 5 → kicad-symbols 5.1.12. Only libraries named by the project are read (the .pro list for
 * KiCad 4, the `lib:` nicknames for KiCad 5), in that order, and only the requested symbols are
 * returned, as one legacy library. Library files are cached in memory and by the CDN.
 */
import { SourceError } from "./server";
import { remainingMs, sharedFetchSignal } from "./request-context";
import { boundedBody } from "@/vendor/canon/lib/allegro-http";

const SOURCES = {
  4: (lib: string) => `https://raw.githubusercontent.com/KiCad/kicad-library/4.0.7/library/${encodeURIComponent(lib)}.lib`,
  5: (lib: string) => `https://gitlab.com/kicad/libraries/kicad-symbols/-/raw/5.1.12/${encodeURIComponent(lib)}.lib`,
} as const;
const MAX_LIB = 3 * 1024 * 1024;
const libraries = new Map<string, Promise<string | null>>();

function libraryText(version: 4 | 5, lib: string): Promise<string | null> {
  const key = `${version}:${lib}`;
  let p = libraries.get(key);
  if (!p) {
    p = (async () => {
      const r = await fetch(SOURCES[version](lib), { redirect: "error", signal: sharedFetchSignal(20_000), next: { revalidate: 604800 } } as RequestInit);
      if (r.status === 404) return null; // not a standard library (a project's own, or a typo)
      if (!r.ok) throw new SourceError("KiCad's symbol library is unavailable right now.", 502);
      if (Number(r.headers.get("content-length") || 0) > MAX_LIB) {
        await r.body?.cancel().catch(() => undefined);
        return null;
      }
      // Read with a real byte cap (Content-Length may be absent or wrong).
      const bytes = await boundedBody(r.body, MAX_LIB).catch(() => null);
      const text = bytes ? new TextDecoder().decode(bytes) : "";
      return text.startsWith("EESchema-LIBRARY") ? text : null;
    })();
    if (libraries.size > 200) libraries.clear();
    libraries.set(key, p);
    p.catch(() => libraries.delete(key));
  }
  return p;
}

/** `DEF … ENDDEF` blocks of a legacy library, with each block's name and aliases. */
function blocks(text: string) {
  const out: { name: string; aliases: string[]; body: string }[] = [];
  const re = /^DEF\s+~?(\S+)[^\n]*\n[\s\S]*?^ENDDEF\s*$/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const aliases = /^ALIAS\s+(.+)$/m.exec(m[0])?.[1].trim().split(/\s+/) ?? [];
    out.push({ name: m[1], aliases, body: m[0] });
  }
  return out;
}

/**
 * One legacy library holding the requested symbols found in the named standard libraries (first
 * library that has a name wins; case-insensitive as a last resort, renamed to the requested name).
 */
export async function legacyStandardSymbols(version: 4 | 5, libs: string[], names: string[]) {
  const wanted = new Set(names);
  const found = new Map<string, string>();
  const lowerWanted = new Map(names.map((n) => [n.toLowerCase(), n]));
  const loose: { lower: string; body: string; name: string }[] = [];
  let read = 0;
  for (const lib of libs) {
    if (found.size === wanted.size) break;
    // No new library download once the request's time is (nearly) up, and at most 12 MB read in all.
    if (remainingMs() < 1_000 || read > 4 * MAX_LIB) break;
    const text = await libraryText(version, lib).catch(() => null);
    if (!text) continue;
    read += text.length;
    for (const b of blocks(text)) {
      for (const n of [b.name, ...b.aliases]) if (wanted.has(n) && !found.has(n)) found.set(n, b.body);
      const lower = b.name.toLowerCase();
      if (lowerWanted.has(lower)) loose.push({ lower, body: b.body, name: b.name });
    }
  }
  for (const l of loose) {
    const requested = lowerWanted.get(l.lower)!;
    if (!found.has(requested)) found.set(requested, l.body.replace(/^DEF\s+(~?)\S+/, `DEF $1${requested}`));
  }
  const unique = [...new Set(found.values())];
  return {
    text: `EESchema-LIBRARY Version 2.3\n#encoding utf-8\n#\n# Standard KiCad ${version} symbols added by the Tindie viewer (the project did not include its symbol cache)\n#\n${unique.join("\n#\n")}\n#\n#End Library\n`,
    found: [...found.keys()],
    missing: names.filter((n) => !found.has(n)),
  };
}
