"use client";
/**
 * Asks before the user leaves a page with unsaved work.
 *
 * - Closing the tab, reloading or typing a new address: the browser's own "Leave site?" prompt
 *   (browsers do not allow a custom dialog there).
 * - Clicking a link inside this app (the Discover tabs, a design, a part…): our dialog, which offers
 *   to save first.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function LeaveGuard({ when, onSave }: { when: boolean; onSave: () => void }) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const armed = useRef(when);
  armed.current = when;

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!armed.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const click = (e: MouseEvent) => {
      if (!armed.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(url.origin === location.origin ? url.pathname + url.search + url.hash : url.href);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, []);

  useEffect(() => {
    if (target) dialog.current?.showModal();
    else dialog.current?.close();
  }, [target]);

  function leave() {
    const to = target;
    armed.current = false;
    setTarget(null);
    if (!to) return;
    if (to.startsWith("/")) router.push(to);
    else location.href = to;
  }

  return (
    <dialog ref={dialog} className="leave-dialog" aria-labelledby="leave-title" onClose={() => setTarget(null)}>
      <h3 id="leave-title">Leave the PCB planner?</h3>
      <p>Your layout has changes that are not saved. Save it as a layout file you can open again later, or leave without saving.</p>
      <div className="leave-actions">
        <button className="btn" onClick={() => setTarget(null)} autoFocus>
          Stay
        </button>
        <button className="btn" onClick={leave}>
          Leave without saving
        </button>
        <button
          className="btn primary"
          onClick={() => {
            onSave();
            leave();
          }}
        >
          Save and leave
        </button>
      </div>
    </dialog>
  );
}
