import type { PcbIr } from "../eda/types";
import type { BoardMeshData } from "./board-mesh";
export function triangulateBoard(
  pcb: PcbIr,
  signal: AbortSignal,
  timeoutMs = 20000,
): Promise<BoardMeshData[]> {
  if (signal.aborted) return Promise.reject(new Error("Cancelled"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./board-worker.ts", import.meta.url));
    let settled = false;
    const finish = (error?: Error, meshes?: BoardMeshData[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(meshes!);
    };
    const abort = () => finish(new Error("Cancelled"));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "PCB geometry took too long to build. Check overlapping cutouts in the source board, then reopen the project.",
          ),
        ),
      timeoutMs,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (e) =>
      finish(e.data.error ? new Error(e.data.error) : undefined, e.data.meshes);
    worker.onerror = () =>
      finish(
        new Error(
          "The PCB geometry worker could not start. Refresh the page and try again.",
        ),
      );
    try {
      worker.postMessage(pcb);
    } catch (e) {
      finish(
        e instanceof Error
          ? e
          : new Error("PCB geometry could not be sent to the worker."),
      );
    }
  });
}
