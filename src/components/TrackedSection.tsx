"use client";
import { useEffect, useRef } from "react";
import { track } from "@/lib/track-client";
import type { TrackKind } from "@/lib/sections";

// Wraps a home-page section to record analytics with no changes to the inner
// components: fires a single "view" when the section first scrolls into the
// viewport (IntersectionObserver), and a "click" when any link/button inside
// it is activated (event delegation).
export function TrackedSection({ name, children, style }: { name: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || viewed.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !viewed.current) {
        viewed.current = true;
        track(name, "view");
        io.disconnect();
      }
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [name]);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("a, button, [role='button']")) {
      track(name, "click" as TrackKind);
    }
  };

  return <div ref={ref} onClick={onClick} style={style}>{children}</div>;
}

