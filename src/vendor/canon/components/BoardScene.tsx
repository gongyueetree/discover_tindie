"use client";
import { useEffect, useRef, useState } from "react";
import type { PcbIr, IrPoint, InputAsset } from "../lib/eda/types";
import { arcPoints, type XY } from "../lib/eda/view-geometry";
import { triangulateBoard } from "../lib/models/board-worker-client";
import { useSceneAnimation } from "./useSceneAnimation";
import {
  boardSilkscreen,
  paintSilkscreen,
} from "../lib/models/board-silkscreen";
import type { MissingModel } from "../lib/models/load-footprints";

export type BodyEnvelope = {
  reference: string;
  x: number;
  y: number;
  w: number;
  h: number;
  height: number;
  rotation: number;
  bottom: boolean;
  /** Tindie: a source model the caller can build (bodyModel); the envelope stands in until it arrives. */
  model?: unknown;
};
const EMPTY_BODIES: BodyEnvelope[] = [];
const EMPTY_ASSETS: InputAsset[] = [];
export function BoardScene({
  pcb,
  assets = EMPTY_ASSETS,
  components = true,
  active = true,
  fallbackBodies = EMPTY_BODIES,
  bodyModel,
}: {
  pcb: PcbIr;
  assets?: InputAsset[];
  components?: boolean;
  active?: boolean;
  fallbackBodies?: BodyEnvelope[];
  /** Tindie: builds a body's model (origin at its centre, z = 0 on the board); null keeps the envelope. */
  bodyModel?: (body: BodyEnvelope, three: typeof import("three")) => Promise<import("three").Object3D | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const reset = useRef(() => {});
  const [error, setError] = useState("");
  const [modelStatus, setModelStatus] = useState("");
  const [missing, setMissing] = useState<MissingModel[]>([]);
  const animate = useSceneAnimation(active);
  useEffect(() => {
    const abort = new AbortController();
    let cancelled = false;
    let cleanup = () => {};
    async function draw() {
      setError("");
      setModelStatus("");
      setMissing([]);
      const THREE = await import("three");
      const { OrbitControls } = await import(
        "three/examples/jsm/controls/OrbitControls.js"
      );
      if (cancelled || !host.current) return;
      const rounded = (w: number, h: number, r: number) => {
        const path = new THREE.Shape();
        const x = w / 2,
          y = h / 2;
        r = Math.min(r, x, y);
        path.moveTo(-x + r, -y);
        path.lineTo(x - r, -y);
        path.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
        path.lineTo(x, y - r);
        path.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
        path.lineTo(-x + r, y);
        path.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
        path.lineTo(-x, -y + r);
        path.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
        path.closePath();
        return path;
      };
      const point = (p: unknown): XY | undefined => {
        const v = p as IrPoint | undefined;
        return v && Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y))
          ? { x: Number(v.x), y: -Number(v.y) }
          : undefined;
      };
      setModelStatus("Building PCB geometry…");
      const bodyMeshes = await triangulateBoard(pcb, abort.signal);
      if (cancelled || !host.current) return;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#dde5df");
      const group = new THREE.Group();
      scene.add(group);
      const resources: Array<{ dispose: () => void }> = [];
      cleanup = () => {
        resources.forEach((r) => r.dispose());
      };
      const material = new THREE.MeshStandardMaterial({
        color: 0x175b3d,
        roughness: 0.7,
        side: THREE.DoubleSide,
      });
      resources.push(material);
      const thickness = Number(pcb.physicalDimensions?.thickness ?? 1.6);
      for (const mesh of bodyMeshes) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(mesh.position, 3),
        );
        geometry.setAttribute(
          "normal",
          new THREE.BufferAttribute(mesh.normal, 3),
        );
        resources.push(geometry);
        group.add(new THREE.Mesh(geometry, material));
      }
      // Project the original SilkS artwork onto the triangulated board surface.
      let silk: ReturnType<typeof boardSilkscreen> = [];
      try {
        silk = boardSilkscreen(pcb, assets);
      } catch {
        /* Invalid source artwork must not prevent board rendering. */
      }
      if (silk.length) {
        const all = bodyMeshes.flatMap((m) => Array.from(m.position));
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (let i = 0; i < all.length; i += 3) {
          minX = Math.min(minX, all[i]);
          maxX = Math.max(maxX, all[i]);
          minY = Math.min(minY, -all[i + 1]);
          maxY = Math.max(maxY, -all[i + 1]);
        }
        const width = maxX - minX,
          height = maxY - minY;
        if (width > 0 && height > 0)
          for (const side of ["front", "back"] as const) {
            if (!silk.some((m) => m.side === side)) continue;
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(
              1,
              Math.round((2048 * width) / Math.max(width, height)),
            );
            canvas.height = Math.max(
              1,
              Math.round((2048 * height) / Math.max(width, height)),
            );
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            paintSilkscreen(ctx, silk, side, { minX, minY, width, height });
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            const ink = new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              depthWrite: false,
              side: THREE.DoubleSide,
              polygonOffset: true,
              polygonOffsetFactor: -1,
            });
            resources.push(texture, ink);
            for (const body of bodyMeshes) {
              const positions: number[] = [],
                uv: number[] = [];
              for (let i = 0; i < body.position.length; i += 9) {
                if (
                  side === "front"
                    ? body.normal[i + 2] < 0.9
                    : body.normal[i + 2] > -0.9
                )
                  continue;
                for (let j = 0; j < 9; j += 3) {
                  const x = body.position[i + j],
                    y = body.position[i + j + 1],
                    z = body.position[i + j + 2];
                  positions.push(x, y, z + (side === "front" ? 0.008 : -0.008));
                  uv.push((x - minX) / width, 1 - (-y - minY) / height);
                }
              }
              if (!positions.length) continue;
              const geometry = new THREE.BufferGeometry();
              geometry.setAttribute(
                "position",
                new THREE.Float32BufferAttribute(positions, 3),
              );
              geometry.setAttribute(
                "uv",
                new THREE.Float32BufferAttribute(uv, 2),
              );
              resources.push(geometry);
              group.add(new THREE.Mesh(geometry, ink));
            }
          }
      }
      const gold = new THREE.MeshStandardMaterial({
        color: 0xc6a24d,
        metalness: 0.65,
        roughness: 0.4,
        side: THREE.DoubleSide,
      });
      resources.push(gold);
      let padIndex = 0;
      for (const pad of pcb.pads) {
        if (++padIndex % 128 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (cancelled) return;
        }
        const p = point(pad.position);
        if (!p || pad.padType === "np_thru_hole") continue;
        const w = Number(pad.size?.x ?? 0),
          h = Number(pad.size?.y ?? 0);
        if (w <= 0 || h <= 0) continue;
        const radius =
          pad.shape === "circle" || pad.shape === "oval"
            ? Math.min(w, h) / 2
            : pad.shape === "roundrect"
              ? Math.min(w, h) * 0.2
              : 0;
        const shape = rounded(w, h, radius);
        if (pad.drill)
          shape.holes.push(
            rounded(
              Number(pad.drill.x),
              Number(pad.drill.y),
              Math.min(Number(pad.drill.x), Number(pad.drill.y)) / 2,
            ),
          );
        const geometry = new THREE.ShapeGeometry(shape);
        resources.push(geometry);
        for (const side of ["F.Cu", "B.Cu"]) {
          if (!pad.layers.includes(side) && !pad.layers.includes("*.Cu"))
            continue;
          const mesh = new THREE.Mesh(geometry, gold);
          mesh.position.set(
            p.x,
            p.y,
            side === "F.Cu" ? thickness + 0.015 : -0.015,
          );
          mesh.rotation.z = (Number(pad.rotation ?? 0) * Math.PI) / 180;
          group.add(mesh);
        }
      }
      if (cancelled) {
        cleanup();
        return;
      }
      const envelopes = new Map<string, InstanceType<typeof THREE.Mesh>>();
      const envelopeMaterial = new THREE.MeshStandardMaterial({
        color: 0x596b74,
        roughness: 0.8,
      });
      resources.push(envelopeMaterial);
      for (const b of fallbackBodies) {
        const g = new THREE.BoxGeometry(b.w, b.h, b.height);
        resources.push(g);
        const mesh = new THREE.Mesh(g, envelopeMaterial);
        mesh.position.set(
          b.x,
          -b.y,
          b.bottom ? -b.height / 2 : thickness + b.height / 2,
        );
        mesh.rotation.z = (-b.rotation * Math.PI) / 180;
        group.add(mesh);
        envelopes.set(b.reference, mesh);
      }
      const box = new THREE.Box3().setFromObject(group),
        center = box.getCenter(new THREE.Vector3()),
        size = box.getSize(new THREE.Vector3());
      group.position.sub(center);
      const distance = Math.max(size.x, size.y, 1) * 1.4;
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, distance * 20);
      camera.position.set(distance * 0.45, -distance * 0.7, distance);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x61796a, 3));
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(0, -distance, distance);
      scene.add(light);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      host.current.appendChild(renderer.domElement);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.update();
      controls.saveState();
      reset.current = () => controls.reset();
      const resize = new ResizeObserver(() => {
        if (!host.current) return;
        const w = host.current.clientWidth,
          h = host.current.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      });
      resize.observe(host.current);
      const stopAnimation = animate(renderer, () => {
        controls.update();
        renderer.render(scene, camera);
      });
      cleanup = () => {
        resize.disconnect();
        stopAnimation();
        controls.dispose();
        const owned = new Set(resources);
        group.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            owned.add(o.geometry);
            for (const m of Array.isArray(o.material)
              ? o.material
              : [o.material])
              owned.add(m);
          }
        });
        owned.forEach((r) => r.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
      setModelStatus("Board ready. Loading component models…");
      // Show the PCB immediately; arriving component instances are appended in place.
      if (components) {
        const { loadFootprintModels } = await import(
          "../lib/models/load-footprints"
        );
        if (cancelled) return;
        const result = await loadFootprintModels(
          pcb,
          assets,
          abort.signal,
          (text) => {
            if (!cancelled) setModelStatus(text);
          },
          { onGroup: (models) => group.add(models) },
        );
        if (cancelled) return;
        for (const placed of result.group.children) {
          const envelope = envelopes.get(placed.name);
          if (envelope) group.remove(envelope);
        }
        setModelStatus(
          result.total === 0 && fallbackBodies.length
            ? `Component bodies: ${fallbackBodies.length} approximate envelopes from the source's 3D outlines (position and footprint from the file, heights estimated). The source's 3D models are not part of the project files.`
            : result.total === 0
            ? `Board geometry ready. No component model references in this file.${pcb.sourceRefs.some((r) => /\.pcbdoc$/i.test(r.path)) ? "Reimport the source project to load embedded models." : ""}`
            : `Component models: ${result.loaded}/${result.total} placements loaded`,
        );
        setMissing(result.failures);
        const withModels = bodyModel ? fallbackBodies.filter((b) => b.model) : [];
        if (withModels.length) {
          setModelStatus(`Loading ${withModels.length} component models from the source library…`);
          let placed = 0,
            next = 0;
          const worker = async () => {
            while (next < withModels.length && !cancelled) {
              const b = withModels[next++];
              const object = await bodyModel!(b, THREE).catch(() => null);
              if (cancelled || !object) continue;
              object.position.set(b.x, -b.y, b.bottom ? 0 : thickness);
              if (b.bottom) object.rotation.x = Math.PI;
              const envelope = envelopes.get(b.reference);
              if (envelope) group.remove(envelope);
              envelopes.delete(b.reference);
              group.add(object);
              placed++;
            }
          };
          await Promise.all(Array.from({ length: 6 }, worker));
          if (cancelled) return;
          setModelStatus(
            placed === withModels.length
              ? `Component models: ${placed}/${withModels.length} loaded from the source library (EasyEDA).`
              : `Component models: ${placed}/${withModels.length} loaded from the source library (EasyEDA); the others are approximate envelopes (heights estimated).`,
          );
        }
      } else setModelStatus("Board and pads ready");
    }
    draw().catch((e) => {
      if (cancelled) return;
      cleanup();
      setModelStatus("3D view could not be prepared.");
      setError(
        e instanceof Error
          ? e.message
          : "3D initialization failed. Check browser WebGL support.",
      );
    });
    return () => {
      cancelled = true;
      abort.abort();
      cleanup();
    };
  }, [pcb, assets, components, animate, fallbackBodies, bodyModel]);
  return (
    <div>
      <div
        className="board-scene-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "12px 20px",
          borderBottom: "1px solid #dde5df",
        }}
      >
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.5,
            flex: 1,
            minWidth: 0,
          }}
        >
          {modelStatus || "Preparing 3D view…"}
        </p>
        <button
          type="button"
          onClick={() => reset.current()}
          style={{
            flexShrink: 0,
            padding: "8px 14px",
            border: "1px solid #cbd5cf",
            borderRadius: 8,
            background: "#fff",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Reset view
        </button>
      </div>
      {error && (
        <p role="alert" style={{ padding: 24 }}>
          {/originalFactory|ChunkLoadError|Loading chunk/i.test(error)
            ? "A 3D code module failed to load. Stop the old server, start the production preview from the new folder, then reload this page."
            : error}
          <button
            type="button"
            className="btn small"
            onClick={() => window.location.reload()}
          >
            Reload viewer
          </button>
        </p>
      )}
      {missing.length > 0 && (
        <details style={{ padding: "8px 20px", fontSize: 13 }}>
          <summary>
            {missing.length} model files unavailable, affecting{" "}
            {missing.reduce((n, m) => n + m.references.length, 0)} placements
            (show details)
          </summary>
          <ul
            style={{
              maxHeight: 160,
              overflow: "auto",
              overflowWrap: "anywhere",
            }}
          >
            {missing.map((m, i) => (
              <li key={i}>
                <strong>{m.references.length} placements: </strong>
                {m.path} — {m.reason}
                <details>
                  <summary>Show references</summary>
                  {m.references.join(", ")}
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div
        ref={host}
        aria-label="PCB 3D view"
        style={{
          height: 600,
          width: "100%",
          display: error ? "none" : "block",
        }}
      />
    </div>
  );
}
