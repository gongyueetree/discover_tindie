/* Browser JSON fetch for the Discover tabs.
   A request the network drops (Safari: "Load failed", Chrome: "Failed to fetch") or a gateway that
   gives up (502/503/504, often an HTML page rather than JSON) is tried once more after a short pause.
   What still fails becomes a plain sentence instead of the browser's own wording. */

export const NETWORK_MESSAGE = "The connection dropped before the list arrived. Check your connection and try again.";
export const BUSY_MESSAGE = "The parts database is slow to answer right now. Try again in a moment.";

const RETRY_STATUS = new Set([502, 503, 504]);

export async function getJson(url: string, opts: { retryMs?: number; fetcher?: typeof fetch } = {}): Promise<any> {
  const doFetch = opts.fetcher ?? fetch;
  const pause = opts.retryMs ?? 1500;
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await doFetch(url);
    } catch (e) {
      // Aborted by the page (navigation): not a network failure.
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      if (attempt === 0) {
        await new Promise((ok) => setTimeout(ok, pause));
        continue;
      }
      throw Error(NETWORK_MESSAGE);
    }
    if (RETRY_STATUS.has(r.status) && attempt === 0) {
      await new Promise((ok) => setTimeout(ok, pause));
      continue;
    }
    let d: any = null;
    try {
      d = await r.json();
    } catch {
      // A body that is not JSON (a gateway's error page, or a body cut off mid-way).
      if (r.ok) throw Error(NETWORK_MESSAGE);
    }
    if (!r.ok) throw Error((d && typeof d.error === "string" && d.error) || (RETRY_STATUS.has(r.status) ? BUSY_MESSAGE : `Request failed (${r.status}).`));
    return d;
  }
}
