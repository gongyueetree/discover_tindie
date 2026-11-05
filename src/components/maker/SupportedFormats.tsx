/** The CAD formats the viewer opens (eelib parser), shown wherever files come in. */
export const CAD_ACCEPT =
  ".zip,.kicad_pro,.kicad_sch,.kicad_pcb,.kicad_mod,.kicad_sym,.pro,.sch,.lib,.brd,.lbr,.fsch,.fbrd,.flbr,.f3z,.PrjPcb,.SchDoc,.PcbDoc,.json,.epro,.eprj,.esch,.epcb,.step,.stp,.wrl";

export const CAD_FORMATS: { name: string; files: string }[] = [
  { name: "KiCad 4–10", files: ".kicad_pro · .kicad_sch · .kicad_pcb" },
  { name: "KiCad 3–5 legacy", files: ".pro · .sch (with its -cache.lib) · .brd · .kicad_pcb version 3/4" },
  { name: "Autodesk EAGLE 6+", files: ".sch · .brd (XML; binary EAGLE 5 and older is not readable)" },
  { name: "Autodesk Fusion Electronics", files: ".fsch · .fbrd, or the EAGLE .sch · .brd export" },
  { name: "Altium Designer", files: ".PrjPcb · .SchDoc · .PcbDoc" },
  { name: "EasyEDA Standard", files: "exported Schematic_*.json · PCB_*.json" },
  { name: "JLCEDA / EasyEDA Pro", files: ".epro · .eprj · .esch · .epcb" },
];

export default function SupportedFormats({ github = false }: { github?: boolean }) {
  return (
    <details className="cad-formats">
      <summary>Supported CAD formats</summary>
      <ul>
        {CAD_FORMATS.map((f) => (
          <li key={f.name}>
            <b>{f.name}</b>
            <span>{f.files}</span>
          </li>
        ))}
      </ul>
      <p>
        {github
          ? "From a GitHub link only the chosen PCB project is fetched: its schematic sheets, board, project file, the local symbol / footprint libraries and 3D models it references, and the licence. Firmware, docs, other boards, backups and Git history are left out."
          : "Upload the project folder as a ZIP, or select its schematic and PCB files together. Binary EAGLE files (before 6.0) must be saved as XML first; Fusion 360 .f3d / .f3z 3D designs hold no schematic or board. Files are read in your browser and not uploaded."}
      </p>
    </details>
  );
}
