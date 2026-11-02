"use client";
import { lockModalScroll } from "@/lib/maker/modal-scroll";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
export default function FullscreenViewer({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const [full, setFull] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    d.close();
    if (full) d.showModal();
    else d.show();
    const release = full ? lockModalScroll() : () => {};
    return () => {
      release();
      d.close();
    };
  }, [full]);
  return (
    <dialog
      ref={dialog}
      className={`maker-view-dialog ${full ? "is-fullscreen" : ""}`}
      aria-label={`${label} viewer`}
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setFull(false);
        trigger.current?.focus();
      }}
    >
      <div className="fullscreen-toolbar">
        <strong>{label}</strong>
        <button
          ref={trigger}
          className="btn small"
          onClick={() => setFull((v) => !v)}
        >
          {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{" "}
          {full ? "Exit fullscreen" : "Fullscreen"}
        </button>
      </div>
      {children}
    </dialog>
  );
}
