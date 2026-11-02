"use client";
import { lockModalScroll } from "@/lib/maker/modal-scroll";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
export default function DatasheetReader({
  url,
  label = "Read datasheet",
}: {
  url: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false),
    [pdf, setPdf] = useState(""),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const prior = document.activeElement as HTMLElement | null;
    const modal = dialog.current;
    modal?.showModal();
    const release = lockModalScroll();
    const ac = new AbortController();
    let objectUrl = "";
    setPdf("");
    setError("");
    fetch("/api/maker/datasheet?" + new URLSearchParams({ url }), {
      signal: ac.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error(await r.text());
        const blob = await r.blob();
        if (ac.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPdf(objectUrl);
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e.message);
      });
    return () => {
      ac.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      release();
      modal?.close();
      prior?.focus();
    };
  }, [open, url]);
  return (
    <>
      <button className="btn small" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="maker datasheet-dialog"
            onCancel={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            onClose={(e) => e.stopPropagation()}
            aria-label="Datasheet reader"
          >
            <header>
              <h2>Datasheet</h2>
              <button className="btn" autoFocus onClick={() => setOpen(false)}>
                Close ×
              </button>
            </header>
            {error ? (
              <p role="alert">{error}</p>
            ) : pdf ? (
              <iframe title="PDF datasheet" src={pdf + "#view=FitH"} />
            ) : (
              <p role="status">Opening PDF for online reading…</p>
            )}
          </dialog>,
          document.body,
        )}
    </>
  );
}
