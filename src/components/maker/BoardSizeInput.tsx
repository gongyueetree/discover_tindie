"use client";
import { useEffect, useState } from "react";
export default function BoardSizeInput({
  label,
  value,
  onCommit,
  min = 20,
  max = 300,
  ariaLabel,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => string | null;
  min?: number;
  max?: number;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(String(value)),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(String(value));
    setError("");
  }, [value]);
  function apply() {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < min || n > max) {
      setError(`Enter ${min}–${max} mm.`);
      return;
    }
    const issue = onCommit(n);
    setError(issue || "");
    if (!issue) setDraft(String(n));
  }
  return (
    <label>
      {label}
      <input
        aria-label={ariaLabel || "Board " + label.toLowerCase()}
        type="number"
        min={min}
        max={max}
        step="any"
        value={draft}
        aria-invalid={!!error}
        onChange={(e) => {
          setDraft(e.target.value);
          setError("");
        }}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
          if (e.key === "Escape") {
            setDraft(String(value));
            setError("");
          }
        }}
      />
      {error && (
        <small role="alert" className="board-size-error">
          {error}
        </small>
      )}
    </label>
  );
}
