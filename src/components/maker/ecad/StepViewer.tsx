"use client";

import { Box, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { stepGroup } from "./step-mesh";

// Ported from gongyueetree/eelib eelib-web/components/ecad/StepViewer.tsx. The STEP reader is the
// occt-import-js build this app already serves from public/workers.
const OCCT_BASE = "/workers";
const t = (key: string) =>
  ({
    "ecad.view3d": "View 3D model",
    "ecad.loading3d": "Loading the model…",
    "ecad.failed3d": "The model could not be shown.",
    "ecad.resetView": "Reset view",
  })[key] ?? key;

/**
 * A STEP model, turned in the browser. Nothing loads until asked: the STEP
 * reader (occt-import-js, served from our own origin) is several megabytes.
 *
 * `load` returns the file's bytes — a short-lived link of the reader's own
 * file, or the library's signed address, which allows cross-origin reads.
 */
export type OcctMesh = {
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
  color?: [number, number, number];
  /** Each b-rep face's triangles (inclusive) and its own colour, if it has one. */
  brep_faces?: { first: number; last: number; color: [number, number, number] | null }[];
};
type Occt = { ReadStepFile: (bytes: Uint8Array, params: null) => { success: boolean; meshes: OcctMesh[] } };
declare global {
  interface Window {
    occtimportjs?: (options: { locateFile: (name: string) => string }) => Promise<Occt>;
  }
}

let occt: Promise<Occt> | null = null;
/** The STEP reader, loaded once per page from our own origin. */
export function loadOcct(): Promise<Occt> {
  occt ??= new Promise<Occt>((resolve, reject) => {
    const ready = () => window.occtimportjs!({ locateFile: (name) => `${OCCT_BASE}/${name}` }).then(resolve, reject);
    if (window.occtimportjs) return void ready();
    const script = document.createElement("script");
    script.src = `${OCCT_BASE}/occt-import-js.js`;
    script.onload = ready;
    script.onerror = () => reject(new Error("occt"));
    document.head.appendChild(script);
  });
  return occt;
}

const cssColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;

/** `autoStart`: load at once (a published work's page, where the model stands in for a missing cover), not on a click. */
export function StepViewer({ load, label, autoStart = false }: { load: () => Promise<ArrayBuffer>; label: string; autoStart?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "shown" | "failed">(autoStart ? "loading" : "idle");
  // What starts the viewer; the state above only reports it, so changing it
  // never tears down the scene this effect built.
  const [requested, setRequested] = useState(autoStart);
  const reset = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!requested || !host.current) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      try {
        const [THREE, { OrbitControls }, reader, bytes] = await Promise.all([
          import("three"),
          import("three/examples/jsm/controls/OrbitControls.js"),
          loadOcct(),
          load(),
        ]);
        const result = reader.ReadStepFile(new Uint8Array(bytes), null);
        if (disposed) return;
        if (!result.success || result.meshes.length === 0) throw new Error("step");

        const element = host.current!;
        const width = element.clientWidth || 320;
        const height = element.clientHeight || 256;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(width, height);
        element.replaceChildren(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(cssColor("--color-eda-3d-bg") ?? "#eef3f5");
        scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(1, 2, 3);
        scene.add(sun);

        const group = stepGroup(THREE, result.meshes, cssColor("--color-eda-3d-body") ?? "gray");
        // KiCad models are Z-up; the view is Y-up.
        group.rotation.x = -Math.PI / 2;
        scene.add(group);

        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
        const camera = new THREE.PerspectiveCamera(35, width / height, radius / 100, radius * 100);
        const home = () => {
          camera.position.copy(center).add(new THREE.Vector3(radius * 1.6, radius * 1.4, radius * 2.2));
          camera.lookAt(center);
          controls.target.copy(center);
          controls.update();
        };
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        home();
        reset.current = home;

        let frame = 0;
        const draw = () => {
          frame = requestAnimationFrame(draw);
          controls.update();
          renderer.render(scene, camera);
        };
        draw();
        setState("shown");
        cleanup = () => {
          cancelAnimationFrame(frame);
          controls.dispose();
          group.traverse((node) => {
            if (node instanceof THREE.Mesh) {
              node.geometry.dispose();
              for (const material of [node.material].flat()) material.dispose();
            }
          });
          renderer.dispose();
        };
      } catch {
        if (!disposed) setState("failed");
      }
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [requested, load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div role="img" aria-label={label} className="ecad-3d">
        {/* three.js owns this element; React never puts children in it. */}
        <div ref={host} style={{ position: "absolute", inset: 0 }} />
        {state !== "shown" ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            {state === "idle" ? (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setState("loading");
                  setRequested(true);
                }}
              >
                <Box aria-hidden size={15} /> {t("ecad.view3d")}
              </button>
            ) : state === "loading" ? (
              <span className="muted">{t("ecad.loading3d")}</span>
            ) : (
              <span className="muted" style={{ padding: "0 16px", textAlign: "center" }}>{t("ecad.failed3d")}</span>
            )}
          </div>
        ) : null}
      </div>
      {state === "shown" ? (
        <button type="button" onClick={() => reset.current?.()} className="ecad-reset">
          <RotateCcw aria-hidden size={12} /> {t("ecad.resetView")}
        </button>
      ) : null}
    </div>
  );
}
