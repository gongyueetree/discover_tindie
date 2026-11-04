/**
 * One deadline and one cancel signal per incoming request, visible to every outgoing call made while
 * handling it (AsyncLocalStorage, so they need not be threaded through every function).
 *
 *  - `fetchSignal(maxMs)` gives a signal that aborts at the earlier of the call's own limit, the
 *    request deadline, or the client going away — the real network request is cancelled, not just
 *    no longer awaited.
 *  - `remainingMs()` is checked again right before anything paid is started.
 * Outside a request (cron jobs, scripts) calls keep their own limits.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** Who is asking: `ip` = hashed client IP; `sid` = verified anonymous session id (null without a cookie). */
export type Who = { ip: string; sid: string | null };
type Ctx = { deadline: number; signal: AbortSignal; who?: Who };
const store = new AsyncLocalStorage<Ctx>();

export function withRequestDeadline<T>(ms: number, clientSignal: AbortSignal | undefined, fn: () => Promise<T>, who?: Who): Promise<T> {
  const deadline = Date.now() + ms;
  const signal = clientSignal ? AbortSignal.any([clientSignal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
  return store.run({ deadline, signal, who }, fn);
}

/** The visitor of the current request, if the handler identified one. */
export function currentWho(): Who | undefined {
  return store.getStore()?.who;
}

/** Milliseconds left in the current request (Infinity outside one). */
export function remainingMs() {
  const c = store.getStore();
  if (!c) return Infinity;
  return c.signal.aborted ? 0 : c.deadline - Date.now();
}

/** The current request's deadline (epoch ms), or `fallbackMs` from now outside a request. */
export function requestDeadline(fallbackMs = 45_000) {
  return store.getStore()?.deadline ?? Date.now() + fallbackMs;
}

/** Signal for one outgoing call: its own limit, the request deadline and client cancellation. */
export function fetchSignal(maxMs: number): AbortSignal {
  const c = store.getStore();
  const own = AbortSignal.timeout(Math.max(1, Math.min(maxMs, c ? c.deadline - Date.now() : maxMs)));
  return c ? AbortSignal.any([own, c.signal]) : own;
}

/**
 * Signal for a call whose result other requests may share (in-flight / response caches): capped by
 * this request's deadline (never longer than `maxMs`), but not cancelled when this one client leaves,
 * so a visitor closing the tab does not fail another visitor waiting on the same answer.
 */
export function sharedFetchSignal(maxMs: number): AbortSignal {
  const c = store.getStore();
  return AbortSignal.timeout(Math.max(1_000, Math.min(maxMs, c ? c.deadline - Date.now() : maxMs)));
}
