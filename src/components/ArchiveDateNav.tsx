"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Single-row date navigation for the archive: previous day / date picker / next day.
// `dates` is the list of available publish dates, sorted newest-first.
//
// The pretty label + programmatic showPicker() combo is blocked inside
// cross-origin iframes (SecurityError) — and this site is embedded on
// tindie via iframe. In that case we fall back to a visible native
// <input type="date">, which always opens the browser calendar on click.
export function ArchiveDateNav({ dates, active }: { dates: string[]; active: string }) {
  const router = useRouter();
  const [nativeInput, setNativeInput] = useState(false);

  useEffect(() => {
    try {
      if (window.self !== window.top) setNativeInput(true);       // embedded in an iframe
      else if (!("showPicker" in HTMLInputElement.prototype)) setNativeInput(true); // old browser
    } catch { setNativeInput(true); } // cross-origin access threw -> definitely iframed
  }, []);

  const idx = dates.indexOf(active);
  const newer = idx > 0 ? dates[idx - 1] : null;              // next day (more recent)
  const older = idx >= 0 && idx < dates.length - 1 ? dates[idx + 1] : null; // previous day

  const dt = new Date(active + "T00:00");
  const label = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  const go = (d: string) => router.push(`/archive?date=${d}`);

  const navBtn = (enabled: boolean): React.CSSProperties => ({
    border: "1px solid #ececec", background: "#fff", borderRadius: 9, padding: "10px 16px",
    fontSize: 13.5, fontWeight: 600, fontFamily: "inherit",
    color: enabled ? "#2f3438" : "#c3cbcf", cursor: enabled ? "pointer" : "default",
  });

  const pickerBox: React.CSSProperties = {
    border: "1px solid #22b8c4", background: "#eefafb", borderRadius: 9, padding: "10px 18px",
    fontSize: 14, fontWeight: 600, color: "#2f3438", cursor: "pointer", fontFamily: "inherit",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
      <button style={navBtn(!!older)} disabled={!older} onClick={() => older && go(older)}>← Previous day</button>

      {nativeInput ? (
        // Visible native date input: user interaction opens the OS calendar
        // even inside cross-origin iframes.
        <input
          type="date" value={active}
          min={dates[dates.length - 1]} max={dates[0]}
          onChange={(e) => e.target.value && go(e.target.value)}
          style={pickerBox}
          aria-label="Pick a date"
        />
      ) : (
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button style={{ ...pickerBox, display: "inline-flex", alignItems: "center", gap: 8 }} tabIndex={-1}>
            <span aria-hidden>📅</span>{label}
          </button>
          {/* Invisible native date input layered over the button; it receives
              the click and opens the picker programmatically. */}
          <input
            type="date" value={active}
            min={dates[dates.length - 1]} max={dates[0]}
            onClick={(e) => {
              try { e.currentTarget.showPicker(); }
              catch { setNativeInput(true); } // blocked -> switch to visible input
            }}
            onChange={(e) => e.target.value && go(e.target.value)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
            aria-label="Pick a date"
          />
        </span>
      )}

      <button style={navBtn(!!newer)} disabled={!newer} onClick={() => newer && go(newer)}>Next day →</button>
    </div>
  );
}

