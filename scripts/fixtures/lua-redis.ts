/**
 * In-memory Redis for tests that runs the app's real Lua scripts (EVAL) in a Lua interpreter (fengari),
 * so the checks exercise the scripts limits.ts sends — not a JavaScript re-implementation of them.
 * Only the commands those scripts and limits.ts use are implemented. Time is injectable for TTL tests.
 * A mock: it says nothing about a real multi-instance Redis deployment.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

type Entry = { v: any; exp?: number };

export function luaRedis(opts: { now?: () => number; delay?: number } = {}) {
  const now = opts.now ?? Date.now;
  const kv = new Map<string, Entry>();
  const live = (k: string) => {
    const e = kv.get(k);
    if (e && e.exp !== undefined && e.exp <= now()) kv.delete(k);
    return kv.get(k);
  };
  const num = (k: string) => Number(live(k)?.v ?? 0);
  const zset = (k: string): Map<string, number> => {
    const e = live(k);
    if (e) return e.v;
    const m = new Map<string, number>();
    kv.set(k, { v: m });
    return m;
  };
  const score = (s: string) => (s === "-inf" ? -Infinity : s === "+inf" ? Infinity : Number(s));

  /** One Redis command; null = nil reply. */
  function command(name: string, a: string[]): any {
    const k = a[0];
    switch (name.toUpperCase()) {
      case "GET": {
        const e = live(k);
        return e ? String(e.v) : null;
      }
      case "SET": {
        let ex: number | undefined;
        let nx = false;
        for (let i = 2; i < a.length; i++) {
          const o = a[i].toUpperCase();
          if (o === "EX") ex = Number(a[++i]) * 1000;
          else if (o === "PX") ex = Number(a[++i]);
          else if (o === "NX") nx = true;
        }
        if (nx && live(k)) return null;
        kv.set(k, { v: a[1], exp: ex !== undefined ? now() + ex : undefined });
        return "OK";
      }
      case "INCR":
      case "INCRBY": {
        const n = num(k) + (name.toUpperCase() === "INCR" ? 1 : Number(a[1]));
        const e = live(k);
        kv.set(k, { v: n, exp: e?.exp });
        return n;
      }
      case "EXPIRE":
      case "PEXPIRE": {
        const e = live(k);
        if (!e) return 0;
        e.exp = now() + Number(a[1]) * (name.toUpperCase() === "EXPIRE" ? 1000 : 1);
        return 1;
      }
      case "TTL": {
        const e = live(k);
        if (!e) return -2;
        return e.exp === undefined ? -1 : Math.ceil((e.exp - now()) / 1000);
      }
      case "EXISTS":
        return live(k) ? 1 : 0;
      case "DEL":
        return kv.delete(k) ? 1 : 0;
      case "ZADD":
        zset(k).set(a[2], score(a[1]));
        return 1;
      case "ZREM":
        return zset(k).delete(a[1]) ? 1 : 0;
      case "ZCARD":
        return live(k) ? zset(k).size : 0;
      case "ZREMRANGEBYSCORE": {
        if (!live(k)) return 0;
        let n = 0;
        for (const [m, s] of zset(k)) if (s >= score(a[1]) && s <= score(a[2])) zset(k).delete(m), n++;
        return n;
      }
    }
    throw Error("lua-redis: unsupported command " + name);
  }

  function pushTable(L: any, list: string[]) {
    lua.lua_createtable(L, list.length, 0);
    list.forEach((s, i) => {
      lua.lua_pushstring(L, to_luastring(s));
      lua.lua_rawseti(L, -2, i + 1);
    });
  }

  function runLua(script: string, keys: string[], args: string[]) {
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);
    pushTable(L, keys);
    lua.lua_setglobal(L, to_luastring("KEYS"));
    pushTable(L, args);
    lua.lua_setglobal(L, to_luastring("ARGV"));
    lua.lua_newtable(L);
    lua.lua_pushcfunction(L, (S: any) => {
      const n = lua.lua_gettop(S);
      const parts: string[] = [];
      for (let i = 1; i <= n; i++) {
        parts.push(to_jsstring(lauxlib.luaL_tolstring(S, i)));
        lua.lua_pop(S, 1);
      }
      const out = command(parts[0], parts.slice(1));
      if (out === null) lua.lua_pushboolean(S, false);
      else if (typeof out === "number") lua.lua_pushinteger(S, out);
      else lua.lua_pushstring(S, to_luastring(String(out)));
      return 1;
    });
    lua.lua_setfield(L, -2, to_luastring("call"));
    lua.lua_setglobal(L, to_luastring("redis"));
    if (lauxlib.luaL_loadstring(L, to_luastring(script)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK)
      throw Error("lua-redis: " + to_jsstring(lua.lua_tostring(L, -1)));
    const t = lua.lua_type(L, -1);
    if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, -1);
    if (t === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(L, -1));
    if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, -1) ? 1 : null;
    return null;
  }

  const wait = () => (opts.delay ? new Promise((r) => setTimeout(r, opts.delay)) : Promise.resolve());
  return {
    kv,
    evals: 0,
    async get(k: string) {
      await wait();
      const e = live(k);
      return e ? e.v : null;
    },
    async set(k: string, v: any, o: { nx?: boolean; ex?: number; px?: number } = {}) {
      await wait();
      if (o.nx && live(k)) return null;
      kv.set(k, { v, exp: o.ex ? now() + o.ex * 1000 : o.px ? now() + o.px : undefined });
      return "OK";
    },
    async incr(k: string) {
      await wait();
      return command("INCR", [k]);
    },
    async incrby(k: string, n: number) {
      await wait();
      return command("INCRBY", [k, String(n)]);
    },
    async expire(k: string, s: number) {
      await wait();
      return command("EXPIRE", [k, String(s)]);
    },
    /** Upstash-style pipeline: commands queued, run in order by exec(). */
    pipeline() {
      const queued: (() => Promise<unknown>)[] = [];
      const self = this;
      const p = {
        set(k: string, v: any, o: any = {}) {
          queued.push(() => self.set(k, v, o));
          return p;
        },
        async exec() {
          const out = [];
          for (const q of queued) out.push(await q());
          return out;
        },
      };
      return p;
    },
    async eval(script: string, keys: string[], args: string[]) {
      await wait();
      this.evals++;
      return runLua(script, keys, args);
    },
    /** TTL in ms for tests (undefined = none / missing). */
    expiresIn(k: string) {
      const e = live(k);
      return e?.exp === undefined ? undefined : e.exp - now();
    },
  };
}
