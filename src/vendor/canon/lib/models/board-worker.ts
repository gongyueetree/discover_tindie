import { buildBoardMeshes } from "./board-mesh";
self.onmessage = (event) => {
  try {
    const meshes = buildBoardMeshes(event.data);
    self.postMessage(
      { meshes },
      { transfer: meshes.flatMap((m) => [m.position.buffer, m.normal.buffer]) },
    );
  } catch (e) {
    self.postMessage({
      error:
        e instanceof Error ? e.message : "PCB geometry could not be generated.",
    });
  }
};
