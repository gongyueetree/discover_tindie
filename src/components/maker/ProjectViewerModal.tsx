"use client";
import { lockModalScroll } from "@/lib/maker/modal-scroll";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
const Viewer = dynamic(() => import("./Viewer"), {
  ssr: false,
  loading: () => <p>Opening project viewer…</p>,
});
export type ProjectRequest = { search: string; files?: File[]; mode?: string };
export default function ProjectViewerModal({
  request,
  onClose,
}: {
  request: ProjectRequest;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const modal = dialog.current;
    modal?.showModal();
    const release = lockModalScroll();
    return () => {
      release();
      modal?.close();
      prior?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      className="maker project-viewer-modal"
      ref={dialog}
      onCancel={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onClose={(e) => e.stopPropagation()}
      aria-label="Engineering project viewer"
    >
      <header>
        <b>Explore circuits / Project viewer</b>
        <button className="btn" autoFocus onClick={onClose}>
          Close ×
        </button>
      </header>
      <Viewer
        initialSearch={request.search}
        initialFiles={request.files}
        focusGithub={request.mode === "github"}
      />
    </dialog>,
    document.body,
  );
}
