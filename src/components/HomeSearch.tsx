"use client";
// Shared search state for the home page. The hero search box writes the query;
// both the Discoveries grid and the Directory read it to filter in place.
import { createContext, useContext, useState, ReactNode } from "react";

type SearchCtx = { q: string; setQ: (v: string) => void };
const Ctx = createContext<SearchCtx>({ q: "", setQ: () => {} });

export function HomeSearchProvider({ children }: { children: ReactNode }) {
  const [q, setQ] = useState("");
  return <Ctx.Provider value={{ q, setQ }}>{children}</Ctx.Provider>;
}

export function useHomeSearch() {
  return useContext(Ctx);
}

// Normalize text for case-insensitive matching.
export function matchText(haystack: string, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return haystack.toLowerCase().includes(s);
}

// The hero search input — writes into the shared context.
export function HomeSearchInput() {
  const { q, setQ } = useHomeSearch();
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", background: "#fff", border: "1px solid #d6dee0", borderRadius: 9, padding: "3px 4px 3px 15px" }}>
      <span style={{ color: "#8a9499" }}>🔍</span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search discoveries and resources…"
        style={{ flex: 1, border: 0, padding: "12px", fontSize: 15, outline: "none", background: "none" }}
      />
      {q && (
        <button onClick={() => setQ("")} aria-label="Clear search" style={{ background: "none", border: 0, fontSize: 18, color: "#8a9499", cursor: "pointer", padding: "0 10px" }}>×</button>
      )}
    </div>
  );
}

