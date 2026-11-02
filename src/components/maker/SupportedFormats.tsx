/** The CAD formats the viewer opens (eelib parser), shown wherever files come in. */
export const CAD_ACCEPT =
  ".zip,.kicad_pro,.kicad_sch,.kicad_pcb,.kicad_mod,.kicad_sym,.pro,.sch,.lib,.brd,.lbr,.PrjPcb,.SchDoc,.PcbDoc,.json,.epro,.eprj,.esch,.epcb,.step,.stp,.wrl";

export const CAD_FORMATS: { name: string; files: string }[] = [
  { name: "KiCad 5–9", files: ".kicad_pro · .kicad_sch · .kicad_pcb · KiCad 5 .sch with its -cache.lib" },
  { name: "Autodesk EAGLE 6+ / Fusion 360 export", files: ".sch · .brd (XML)" },
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
          : "Upload the project folder as a ZIP, or select its schematic and PCB files together. Binary EAGLE files (before 6.0) must be saved as XML first. Files are read in your browser and not uploaded."}
      </p>
    </details>
  );
}
