"use client";
import { useEffect, useState } from "react";

/** Admin dashboard card: is the Tindie parts database (ezplm_partdata Partner API) reachable? */
export function PartdataStatus() {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/partdata", { cache: "no-store" });
      setD(await r.json());
    } catch (e) {
      setD({ ok: false, error: { message: String(e) } });
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void check();
  }, []);
  const color = !d ? "#8a9499" : d.ok ? "#268a52" : d.configured === false ? "#9a6b08" : "#c2415f";
  const label = !d ? "Checking…" : d.ok ? "Connected" : d.configured === false ? "Not configured" : "Error";
  return (
    <div style={{ background: "#fff", border: "1px solid #ececec", borderRadius: 12, padding: "16px 18px", marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#2f3438" }}>Parts database (Components / Open hardware / Graph)</h3>
        <button onClick={() => void check()} disabled={busy} style={{ fontSize: 12.5, fontWeight: 600, color: "#1aa0ab", background: "none", border: "1px solid #22b8c4", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>
          {busy ? "Checking…" : "Re-check"}
        </button>
      </div>
      <p style={{ marginTop: 8, fontSize: 13.5 }}>
        <b style={{ color }}>● {label}</b>
        {d?.host && <span style={{ color: "#6a7176" }}> · {d.host} · key {d.keyId}</span>}
        {typeof d?.latencyMs === "number" && <span style={{ color: "#6a7176" }}> · {d.latencyMs} ms</span>}
        {d?.remainingToday && <span style={{ color: "#6a7176" }}> · {d.remainingToday} calls left today</span>}
      </p>
      {d?.snapshot && (
        <p style={{ fontSize: 13, color: "#6a7176", marginTop: 4 }}>
          Knowledge graph: {d.snapshot.designs} designs · {d.snapshot.families} families · {d.snapshot.pairs} relationships
          {d.snapshot.computedAt ? ` · built ${new Date(d.snapshot.computedAt).toLocaleString()}` : ""}
        </p>
      )}
      {d?.configured === false && (
        <p style={{ fontSize: 13, color: "#9a6b08", marginTop: 4 }}>
          Set PARTDATA_API_BASE, PARTDATA_API_KEY and PARTDATA_API_SECRET in the server environment (see README).
        </p>
      )}
      {d?.error && <p style={{ fontSize: 13, color: "#c2415f", marginTop: 4 }}>{d.error.code ? `${d.error.code}: ` : ""}{d.error.message}</p>}
    </div>
  );
}
