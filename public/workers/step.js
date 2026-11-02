/* STEP tessellation stays off the UI thread; no network paths from input are used. */
importScripts("/workers/occt-import-js.js");
const ready = occtimportjs({ locateFile: (name) => "/workers/" + name });
onmessage = async (event) => {
  try {
    const occt = await ready;
    const result = occt.ReadStepFile(new Uint8Array(event.data), {
      linearUnit: "millimeter",
      linearDeflectionType: "bounding_box_ratio",
      linearDeflection: 0.002,
      angularDeflection: 0.5,
    });
    if (!result.success || !result.meshes?.length)
      throw new Error("The STEP file contains no displayable meshes");
    if (
      result.meshes.reduce(
        (n, m) => n + m.attributes.position.array.length,
        0,
      ) > 15000000
    )
      throw new Error("The model is too complex. Export a simplified STEP.");
    postMessage({ meshes: result.meshes });
  } catch (error) {
    postMessage({ error: String(error.message || error) });
  }
};

