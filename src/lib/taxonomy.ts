export type Tax = { id: string; name: string; ic: string; col: string };

export const TAXONOMY: Tax[] = [
  { id: "components",    name: "Parts & Resources", ic: "⬡",  col: "#1c8290" },
  { id: "tools",         name: "Design & Develop",  ic: "✎",  col: "#4a6fd4" },
  { id: "manufacturing", name: "Manufacture",       ic: "⚙",  col: "#f2762e" },
  { id: "open-source",   name: "Learn & Share",     ic: "</>", col: "#2f9d62" },
  { id: "crowdfunding",  name: "Launch & Sell",     ic: "◆",  col: "#e0556b" },
];

export const taxName = (id: string) => TAXONOMY.find((t) => t.id === id)?.name ?? id;
export const taxCol = (id: string) => TAXONOMY.find((t) => t.id === id)?.col ?? "#1c6e7e";

export const SRC_COLORS: Record<string, string> = {
  GitHub: "#1d5163", "Crowd Supply": "#f2762e", Kickstarter: "#3ea76a", "Hackaday.io": "#d99a00",
  "Seeed Studio": "#0aa14b", LCSC: "#4a6fd4", Indiegogo: "#e0556b", Adafruit: "#7a5cff",
  DigiKey: "#cc0000", Mouser: "#0046ad", SparkFun: "#e1352f", Lectronz: "#5b3fd0",
  LilyGO: "#0aa14b", Sipeed: "#1c6e7e", "Aidan Lawrence": "#7a5cff", Espressif: "#e7352c",
  GroupGets: "#1aa0ab", PlatformIO: "#7a5cff", KiCad: "#22b8c4", PCBWay: "#f2762e",
};
export const srcColor = (n: string) => SRC_COLORS[n] ?? "#1c6e7e";

export const ini = (n: string) =>
  n.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export const RELATED_PRODUCTS: Record<string, { t: string; s: string; p: string; ic: string }[]> = {
  risc: [{ t: "RISC-V GD32V Module", s: "pine64store", p: "$12", ic: "🔲" }, { t: "JTAG Debugger Probe", s: "BitsKit", p: "$24", ic: "🔌" }],
  esp32: [{ t: "ESP32-S3 Breakout", s: "UnexpectedMaker", p: "$19", ic: "🟩" }, { t: "BME680 Sensor Board", s: "Pimoroni", p: "$22", ic: "🌡️" }],
  test: [{ t: "SMD Component Kit", s: "A2Store", p: "$35", ic: "🧰" }, { t: "Bench PSU Module", s: "brain4free", p: "$45", ic: "⚡" }],
  robot: [{ t: "20kg Digital Servo x4", s: "OMG Robotics", p: "$48", ic: "⚙️" }, { t: "9-DOF IMU Board", s: "NandFarm", p: "$16", ic: "🧭" }],
  tools: [{ t: "USB Logic Analyzer", s: "dekuNukem", p: "$29", ic: "📟" }],
  fpga: [{ t: "FPGA Breakout Adapter", s: "A2Store", p: "$14", ic: "🟦" }],
  audio: [{ t: "I²S DAC Module", s: "Pentode Art", p: "$18", ic: "🔊" }],
  power: [{ t: "USB-C PD Trigger Board", s: "SmartHomeGuys", p: "$9", ic: "🔋" }],
  can: [{ t: "CAN Bus Transceiver", s: "AQEX", p: "$13", ic: "🚌" }],
  lora: [{ t: "LoRa SX1262 Module", s: "TheHogNL", p: "$21", ic: "📡" }],
};

export const DAILY_TARGET = 12;

