// Ported from gongyueetree/eelib eelib-web/lib/ecad/step-mesh.ts (unchanged logic).
import type { OcctMesh } from "./StepViewer";

/**
 * A STEP model's meshes (from occt-import-js) as one three.js group, in the
 * colours the model carries.
 *
 * Colour lives at two levels: a mesh may have one, and each b-rep face may
 * have its own. KiCad's library models colour only their faces — black body,
 * light-grey pins, tan ceramic — so reading the mesh colour alone paints the
 * whole part in the fallback. Each face's triangles become a draw group with
 * its own material; a face without a colour takes the mesh's, then the
 * fallback. occt reports colours in sRGB.
 */
type Three = typeof import("three");

/**
 * Bright, unsaturated faces are metal (pins, leads, shields): a little sheen,
 * but mostly their own colour — fully metallic surfaces reflect the scene's
 * surroundings, and an empty scene makes them look black.
 */
function looksMetal([r, g, b]: number[]) {
  const max = Math.max(r!, g!, b!);
  const min = Math.min(r!, g!, b!);
  return max > 0.45 && max - min < 0.35;
}

export function stepGroup(THREE: Three, meshes: readonly OcctMesh[], fallback: string): import("three").Group {
  const group = new THREE.Group();
  const materials = new Map<string, import("three").MeshStandardMaterial>();
  const material = (rgb: number[] | null | undefined) => {
    const key = rgb ? rgb.map((value) => value.toFixed(3)).join(",") : "fallback";
    let found = materials.get(key);
    if (!found) {
      const color = rgb ? new THREE.Color().setRGB(rgb[0]!, rgb[1]!, rgb[2]!, THREE.SRGBColorSpace) : new THREE.Color(fallback);
      const metal = rgb ? looksMetal(rgb) : false;
      found = new THREE.MeshStandardMaterial({ color, metalness: metal ? 0.3 : 0, roughness: metal ? 0.35 : 0.65 });
      materials.set(key, found);
    }
    return found;
  };

  for (const mesh of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3));
    if (mesh.attributes.normal) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3));
    else geometry.computeVertexNormals();
    geometry.setIndex(mesh.index.array);

    const faces = mesh.brep_faces ?? [];
    if (faces.length === 0 || faces.every((face) => !face.color)) {
      group.add(new THREE.Mesh(geometry, material(mesh.color)));
      continue;
    }
    // One draw group per face, each with its colour's material (shared between faces of one colour).
    const used: import("three").MeshStandardMaterial[] = [];
    for (const face of faces) {
      const chosen = material(face.color ?? mesh.color);
      let slot = used.indexOf(chosen);
      if (slot < 0) slot = used.push(chosen) - 1;
      geometry.addGroup(face.first * 3, (face.last - face.first + 1) * 3, slot);
    }
    group.add(new THREE.Mesh(geometry, used));
  }
  return group;
}
