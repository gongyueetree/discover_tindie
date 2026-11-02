import type { InputAsset, PcbIr } from "../eda/types";
export function modelAssets(assets: InputAsset[]) {
  return assets.filter((a) => /\.(wrl|step|stp)$/i.test(a.path));
}
export function boardAssembly(pcb: PcbIr, assets: InputAsset[]) {
  const source = pcb.sourceRefs[0]?.path ?? "";
  const stem = source.replace(/\.[^.]+$/, "").toLowerCase();
  return (
    assets.find((a) => a.path.toLowerCase() === stem + ".wrl") ??
    assets.find((a) => a.path.toLowerCase() === stem + ".step") ??
    assets.find((a) => a.path.toLowerCase() === stem + ".stp")
  );
}
export function validateVrml(text: string) {
  if (!text.startsWith("#VRML V2.0")) throw new Error("Only VRML 2.0 models are supported");
  if (/\b(?:Inline|ImageTexture|MovieTexture|AudioClip|Script)\s*\{/.test(text))
    throw new Error("The model references external resources. Export a self-contained WRL or STEP.");
}

