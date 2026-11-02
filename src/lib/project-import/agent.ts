import { buildArtifactManifest, loadGithubProject } from "./github";
import type {
  AnalyzeUrlInput,
  ArtifactManifest,
  HardwareFacts,
  ListingDraft,
  ListingField,
  ProjectImportResult,
} from "./types";

function field<T>(
  value: T | null,
  status: ListingField<T>["status"],
  confidence?: number,
  evidence: string[] = []
): ListingField<T> {
  return { value, status, confidence, evidence };
}

function stripMarkdown(input: string) {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLine(input: string) {
  return input
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstUsefulParagraph(readme: string) {
  const blocks = readme
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n\s*\n/)
    .map((block) => stripMarkdown(block))
    .filter((block) => block.length >= 45)
    .filter((block) => !/^(license|installation|usage|table of contents)/i.test(block));
  return blocks[0] ?? "";
}

function findSection(readme: string, headingPatterns: RegExp[]) {
  const lines = readme.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const heading = line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim();
    if (!heading || !headingPatterns.some((pattern) => pattern.test(heading))) continue;

    const collected: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = lines[cursor];
      if (/^#{1,6}\s+/.test(next.trim())) break;
      if (next.trim()) collected.push(next);
      if (collected.join(" ").length > 1400) break;
    }
    const text = stripMarkdown(collected.join("\n"));
    if (text.length >= 20) return text;
  }
  return "";
}

function extractFeatureBullets(readme: string) {
  const section = findSection(readme, [/feature/i, /highlight/i, /capabilit/i, /what makes/i]);
  const source = section || readme;
  const bullets = source
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*+]\s+/.test(line))
    .map(cleanLine)
    .filter((line) => line.length >= 8 && line.length <= 180)
    .filter((line) => !/badge|license|build status|sponsor/i.test(line));
  return Array.from(new Set(bullets)).slice(0, 7);
}

const PROCESSORS: Array<[RegExp, string]> = [
  [/\brp2350b?\b/i, "RP2350"],
  [/\brp2040\b/i, "RP2040"],
  [/\besp32[-_ ]?p4\b/i, "ESP32-P4"],
  [/\besp32[-_ ]?s3\b/i, "ESP32-S3"],
  [/\besp32[-_ ]?c[236]\b/i, "ESP32-C series"],
  [/\besp32\b/i, "ESP32"],
  [/\bstm32[a-z0-9-]*\b/i, "STM32"],
  [/\bnrf52[a-z0-9-]*\b/i, "nRF52"],
  [/\bpic18[a-z0-9-]*\b/i, "PIC18"],
  [/\batmega[a-z0-9-]*\b/i, "AVR ATmega"],
  [/\bice40[a-z0-9-]*\b/i, "Lattice iCE40"],
  [/\bmachxo2[a-z0-9-]*\b|\bxo2[-_ ]?\d+/i, "Lattice MachXO2"],
  [/\becp5[a-z0-9-]*\b/i, "Lattice ECP5"],
];

const INTERFACES: Array<[RegExp, string]> = [
  [/usb[- ]?c/i, "USB-C"],
  [/\busb\b/i, "USB"],
  [/\bi2c\b|i²c/i, "I2C"],
  [/\bspi\b/i, "SPI"],
  [/\buart\b|serial port/i, "UART"],
  [/\bcan(?: bus)?\b/i, "CAN"],
  [/\bi2s\b/i, "I2S"],
  [/ethernet/i, "Ethernet"],
  [/wi[- ]?fi|wifi/i, "Wi-Fi"],
  [/bluetooth|\bble\b/i, "Bluetooth LE"],
  [/\blora\b/i, "LoRa"],
  [/\bgpio\b/i, "GPIO"],
  [/\bswd\b/i, "SWD"],
  [/\bjtag\b/i, "JTAG"],
];

function detectHardware(text: string): HardwareFacts {
  const processors = PROCESSORS.filter(([pattern]) => pattern.test(text)).map(([, name]) => name);
  const interfaces = INTERFACES.filter(([pattern]) => pattern.test(text)).map(([, name]) => name);
  const dimensionMatch = text.match(
    /\b(\d{1,3}(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d{1,3}(?:\.\d+)?)\s*(mm|cm)\b/i
  );
  const dimensions = dimensionMatch
    ? `${dimensionMatch[1]} × ${dimensionMatch[2]} ${dimensionMatch[3].toLowerCase()}`
    : null;

  const coreParts = Array.from(
    new Set(
      PROCESSORS.filter(([pattern]) => pattern.test(text)).map(([, name]) => name)
    )
  ).slice(0, 8);

  return {
    processors: Array.from(new Set(processors)),
    interfaces: Array.from(new Set(interfaces)),
    dimensions,
    coreParts,
  };
}

function inferCategory(text: string) {
  const normalized = text.toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ["Test Equipment", /(oscilloscope|logic analyzer|waveform|signal generator|measurement|multimeter|debugger)/g],
    ["Development Boards", /(development board|dev board|microcontroller|fpga|rp2040|rp2350|esp32|stm32)/g],
    ["Sensors", /(sensor|temperature|humidity|pressure|imu|accelerometer|environment)/g],
    ["Wireless & IoT", /(lora|wifi|wi-fi|bluetooth|wireless|iot|radio|rf )/g],
    ["Robotics", /(robot|motor control|servo|stepper|rover|drone)/g],
    ["Power & Battery", /(power supply|battery|charger|buck|boost|power module)/g],
    ["Displays", /(display|lcd|oled|e-ink|epaper|screen)/g],
  ];
  const scores: Array<[string, number]> = rules.map(([category, regex]) => [
    category,
    normalized.match(regex)?.length ?? 0,
  ]);

  scores.sort((a, b) => b[1] - a[1]);
  const [category, score] = scores[0];
  return {
    category: score > 0 ? category : "Other",
    confidence: score > 2 ? 0.9 : score > 0 ? 0.75 : 0.52,
  };
}

function humanizeRepoName(name: string) {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => (part.length <= 4 && /\d/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function short140(input: string) {
  const text = input.replace(/\s+/g, " ").trim();
  if (text.length <= 140) return text;
  return `${text.slice(0, 137).trimEnd()}...`;
}

function buildReadiness(manifest: ArtifactManifest, description: string) {
  let score = 0;
  if (manifest.readme) score += 18;
  if (manifest.schematic > 0) score += 15;
  if (manifest.pcb > 0) score += 15;
  if (manifest.bom > 0) score += 10;
  if (manifest.images >= 2) score += 15;
  else if (manifest.images === 1) score += 8;
  if (manifest.docs > 0) score += 8;
  if (manifest.firmware > 0) score += 8;
  if (manifest.gerber > 0) score += 5;
  if (manifest.cad > 0) score += 3;
  if (description.length > 40) score += 3;
  return Math.min(100, score);
}

function buildWarnings(manifest: ArtifactManifest) {
  const warnings: string[] = [];
  if (!manifest.readme) warnings.push("No README was found. Add a concise project overview before publishing.");
  if (manifest.images === 0) warnings.push("No usable product images were detected. Tindie requires at least one image.");
  if (manifest.schematic === 0) warnings.push("No schematic file was detected; technical evidence coverage will be lower.");
  if (manifest.bom === 0) warnings.push("No BOM was detected; core component extraction may be incomplete.");
  if (manifest.docs === 0) warnings.push("No dedicated user documentation was detected. Consider adding a quick-start guide.");
  return warnings;
}

function buildGithubDraft(params: {
  repoName: string;
  repoUrl: string;
  repoDescription: string;
  readme: string;
  hardware: HardwareFacts;
}) {
  const { repoName, repoUrl, repoDescription, readme, hardware } = params;
  const paragraph = firstUsefulParagraph(readme);
  const overview =
    findSection(readme, [/what is it/i, /overview/i, /^about$/i, /introduction/i]) ||
    repoDescription ||
    paragraph ||
    `${humanizeRepoName(repoName)} is an open hardware project imported from GitHub.`;
  const why =
    findSection(readme, [/why did you make/i, /^why$/i, /motivation/i, /background/i]) ||
    `This listing was generated from the project's engineering repository. Review this section and add the maker story behind ${humanizeRepoName(repoName)}.`;
  const features = extractFeatureBullets(readme);
  const special =
    findSection(readme, [/what makes it special/i, /highlights/i, /features/i]) ||
    (features.length
      ? features.join(" · ")
      : [hardware.processors[0], ...hardware.interfaces.slice(0, 4)].filter(Boolean).join(" · ")) ||
    "Review the imported engineering files and add the product's differentiating features.";
  const category = inferCategory(`${repoName} ${repoDescription} ${readme.slice(0, 10000)}`);
  const titleBase = humanizeRepoName(repoName);
  const title = hardware.processors[0] && !titleBase.toLowerCase().includes(hardware.processors[0].toLowerCase())
    ? `${titleBase} — ${hardware.processors[0]} Hardware Project`
    : titleBase;

  return {
    title: field(title.slice(0, 120), "AI_GENERATED", 0.86, ["GitHub repository name", "README"]),
    category: field(category.category, "AI_INFERRED", category.confidence, ["README", "Repository description"]),
    shortDescription: field(short140(repoDescription || paragraph || overview), "AI_GENERATED", 0.86, ["README", "Repository description"]),
    modelNumber: field(repoName.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 48), "AI_GENERATED", 0.7, ["Repository name"]),
    whatIsIt: field(overview.slice(0, 1600), repoDescription || paragraph ? "SOURCE_EXTRACTED" : "AI_GENERATED", 0.9, ["README", "Repository description"]),
    whyMadeIt: field(why.slice(0, 1200), /Review this section/.test(why) ? "AI_GENERATED" : "SOURCE_EXTRACTED", 0.65, ["README"]),
    whatMakesSpecial: field(special.slice(0, 1200), features.length ? "SOURCE_EXTRACTED" : "AI_GENERATED", 0.76, ["README", "Detected hardware"]),
    features: field(features.length ? features : [
      ...hardware.processors.map((item) => `Built around ${item}`),
      ...hardware.interfaces.slice(0, 5).map((item) => `${item} interface`),
    ].slice(0, 7), features.length ? "SOURCE_EXTRACTED" : "AI_GENERATED", 0.78, ["README", "Detected hardware"]),
    documentationUrl: field(repoUrl, "SOURCE_EXTRACTED", 1, ["GitHub repository"]),
    sourceCodeUrl: field(repoUrl, "SOURCE_EXTRACTED", 1, ["GitHub repository"]),
    designFilesUrl: field(repoUrl, "SOURCE_EXTRACTED", 1, ["GitHub repository"]),
    price: field<number>(null, "MISSING"),
    inventory: field<number>(null, "MISSING"),
    weight: field<number>(null, "MISSING"),
    shipsFrom: field<string>(null, "MISSING"),
    shippingProfile: field<string>(null, "MISSING"),
    handlingDays: field<number>(null, "MISSING"),
  } satisfies ListingDraft;
}

function extractResponseText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content?.text === "string") return content.text;
    }
  }
  return "";
}

function parseJsonFromModel(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Model output was not valid JSON");
  }
}

async function refineWithOpenAI(
  draft: ListingDraft,
  context: { projectName: string; repoDescription: string; readme: string; hardware: HardwareFacts }
) {
  if (!process.env.OPENAI_API_KEY) return { draft, enhanced: false };

  try {
    const prompt = `You are the Tindie Project Import Agent. Improve a hardware product listing using ONLY the supplied project evidence. Do not invent selling price, stock, shipping, certifications, dimensions, electrical limits, performance claims, or included accessories. Return JSON only with keys: title, category, shortDescription, whatIsIt, whyMadeIt, whatMakesSpecial, features. features must be an array of at most 7 strings. Keep Tindie's maker tone and preserve facts.\n\nProject: ${context.projectName}\nRepository description: ${context.repoDescription}\nDetected hardware: ${JSON.stringify(context.hardware)}\nCurrent draft: ${JSON.stringify({
      title: draft.title.value,
      category: draft.category.value,
      shortDescription: draft.shortDescription.value,
      whatIsIt: draft.whatIsIt.value,
      whyMadeIt: draft.whyMadeIt.value,
      whatMakesSpecial: draft.whatMakesSpecial.value,
      features: draft.features.value,
    })}\nREADME excerpt:\n${context.readme.slice(0, 12000)}`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5",
        input: prompt,
        store: false,
      }),
      cache: "no-store",
    });

    if (!response.ok) return { draft, enhanced: false };
    const payload = await response.json();
    const parsed = parseJsonFromModel(extractResponseText(payload));
    const next: ListingDraft = {
      ...draft,
      title: typeof parsed.title === "string" ? field(parsed.title.slice(0, 120), "AI_GENERATED", 0.91, draft.title.evidence) : draft.title,
      category: typeof parsed.category === "string" ? field(parsed.category.slice(0, 80), "AI_INFERRED", 0.85, draft.category.evidence) : draft.category,
      shortDescription: typeof parsed.shortDescription === "string" ? field(short140(parsed.shortDescription), "AI_GENERATED", 0.91, draft.shortDescription.evidence) : draft.shortDescription,
      whatIsIt: typeof parsed.whatIsIt === "string" ? field(parsed.whatIsIt.slice(0, 1800), "AI_GENERATED", 0.88, draft.whatIsIt.evidence) : draft.whatIsIt,
      whyMadeIt: typeof parsed.whyMadeIt === "string" ? field(parsed.whyMadeIt.slice(0, 1400), "AI_GENERATED", 0.78, draft.whyMadeIt.evidence) : draft.whyMadeIt,
      whatMakesSpecial: typeof parsed.whatMakesSpecial === "string" ? field(parsed.whatMakesSpecial.slice(0, 1400), "AI_GENERATED", 0.85, draft.whatMakesSpecial.evidence) : draft.whatMakesSpecial,
      features: Array.isArray(parsed.features)
        ? field(parsed.features.filter((item: unknown) => typeof item === "string").slice(0, 7), "AI_GENERATED", 0.86, draft.features.evidence)
        : draft.features,
    };
    return { draft: next, enhanced: true };
  } catch {
    return { draft, enhanced: false };
  }
}

export async function analyzeGithubProject(owner: string, repo: string): Promise<ProjectImportResult> {
  const project = await loadGithubProject(owner, repo);
  const manifest = buildArtifactManifest(project.files, Boolean(project.readme.trim()));
  const combinedText = `${project.metadata.name}\n${project.metadata.description}\n${project.readme.slice(0, 20000)}`;
  const hardware = detectHardware(combinedText);
  const baseDraft = buildGithubDraft({
    repoName: project.metadata.name,
    repoUrl: project.metadata.htmlUrl,
    repoDescription: project.metadata.description,
    readme: project.readme,
    hardware,
  });
  const refined = await refineWithOpenAI(baseDraft, {
    projectName: project.metadata.name,
    repoDescription: project.metadata.description,
    readme: project.readme,
    hardware,
  });
  const completeness = buildReadiness(manifest, project.metadata.description || firstUsefulParagraph(project.readme));
  const evidenceCoverage = Math.min(
    100,
    35 +
      (manifest.schematic > 0 ? 20 : 0) +
      (manifest.pcb > 0 ? 15 : 0) +
      (manifest.bom > 0 ? 15 : 0) +
      (manifest.readme ? 10 : 0) +
      (manifest.docs > 0 ? 5 : 0)
  );

  return {
    id: `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    sourceType: "github",
    sourceLabel: `GitHub · ${project.metadata.fullName}`,
    sourceUrl: project.metadata.htmlUrl,
    projectName: project.metadata.name,
    projectDescription: project.metadata.description || firstUsefulParagraph(project.readme),
    manifest,
    hardware,
    listing: refined.draft,
    readiness: {
      completeness,
      evidenceCoverage,
      sellerConfirmation: 0,
    },
    warnings: buildWarnings(manifest),
    sellerRequired: ["Price", "Inventory", "Ships from", "Shipping profile", "Handling time", "Package weight"],
    aiEnhanced: refined.enhanced,
    generatedAt: new Date().toISOString(),
  };
}

const ALLOWED_URL_HOSTS = [
  "hackaday.io",
  "www.hackaday.io",
  "hackster.io",
  "www.hackster.io",
  "ezplm.com",
  "www.ezplm.com",
  "eetree.cn",
  "www.eetree.cn",
  "github.com",
  "www.github.com",
  "instructables.com",
  "www.instructables.com",
];

function assertSafeProjectUrl(input: string) {
  const url = new URL(input);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http/https project URLs are supported.");
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not supported.");
  const host = url.hostname.toLowerCase();
  const allowAny = process.env.PROJECT_IMPORT_ALLOW_ANY_URL === "true";
  if (!allowAny && !ALLOWED_URL_HOSTS.includes(host)) {
    throw new Error("For this prototype, URL import is limited to GitHub, Hackaday, Hackster, ezPLM, EETree and Instructables.");
  }
  if (host === "localhost" || host.endsWith(".local") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) {
    throw new Error("Private or local network addresses are not allowed.");
  }
  return url;
}

function extractMeta(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyFirst = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"));
  const contentFirst = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"));
  return (propertyFirst?.[1] ?? contentFirst?.[1] ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function analyzeProjectUrl(input: AnalyzeUrlInput): Promise<ProjectImportResult> {
  const url = assertSafeProjectUrl(input.url);

  if (url.hostname.toLowerCase().includes("github.com")) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return analyzeGithubProject(parts[0], parts[1].replace(/\.git$/, ""));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let html = "";
  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 TindieProjectImportAgent/1.0" },
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Project page returned ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) throw new Error("Project URL did not return an HTML page.");
    html = (await response.text()).slice(0, 1_500_000);
  } finally {
    clearTimeout(timer);
  }

  const title = extractMeta(html, "og:title") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || url.hostname;
  const description = extractMeta(html, "og:description") || extractMeta(html, "description") || "";
  const bodyText = htmlToText(html).slice(0, 30000);
  const hardware = detectHardware(`${title} ${description} ${bodyText}`);
  const category = inferCategory(`${title} ${description} ${bodyText}`);
  const features = Array.from(new Set([
    ...hardware.processors.map((item) => `Built around ${item}`),
    ...hardware.interfaces.slice(0, 5).map((item) => `${item} interface`),
  ])).slice(0, 7);

  const manifest: ArtifactManifest = {
    totalFiles: 0,
    readme: false,
    schematic: 0,
    pcb: 0,
    bom: 0,
    gerber: 0,
    firmware: 0,
    cad: 0,
    images: extractMeta(html, "og:image") ? 1 : 0,
    docs: 0,
    examples: 0,
    evidenceFiles: [url.toString()],
  };

  const overview = description || bodyText.slice(0, 900) || `Project imported from ${url.hostname}.`;
  const listing: ListingDraft = {
    title: field(stripMarkdown(title).slice(0, 120), "SOURCE_EXTRACTED", 0.9, [url.toString()]),
    category: field(category.category, "AI_INFERRED", category.confidence, [url.toString()]),
    shortDescription: field(short140(description || overview), description ? "SOURCE_EXTRACTED" : "AI_GENERATED", 0.82, [url.toString()]),
    modelNumber: field<string>(null, "MISSING"),
    whatIsIt: field(overview.slice(0, 1500), "SOURCE_EXTRACTED", 0.75, [url.toString()]),
    whyMadeIt: field("Review the imported project story and add why you created this product.", "AI_GENERATED", 0.45, [url.toString()]),
    whatMakesSpecial: field(features.join(" · ") || "Review the project and add its differentiating features.", "AI_GENERATED", 0.55, [url.toString()]),
    features: field(features, "AI_INFERRED", 0.6, [url.toString()]),
    documentationUrl: field(url.toString(), "SOURCE_EXTRACTED", 1, [url.toString()]),
    sourceCodeUrl: field<string>(null, "MISSING"),
    designFilesUrl: field<string>(null, "MISSING"),
    price: field<number>(null, "MISSING"),
    inventory: field<number>(null, "MISSING"),
    weight: field<number>(null, "MISSING"),
    shipsFrom: field<string>(null, "MISSING"),
    shippingProfile: field<string>(null, "MISSING"),
    handlingDays: field<number>(null, "MISSING"),
  };

  const completeness = Math.min(68, 28 + (description ? 18 : 0) + (manifest.images ? 12 : 0) + (hardware.processors.length ? 10 : 0));
  return {
    id: `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    sourceType: input.sourceType,
    sourceLabel: `${input.sourceType === "url" ? "Web" : input.sourceType} · ${url.hostname}`,
    sourceUrl: url.toString(),
    projectName: stripMarkdown(title),
    projectDescription: description || overview,
    manifest,
    hardware,
    listing,
    readiness: { completeness, evidenceCoverage: 45, sellerConfirmation: 0 },
    warnings: [
      "URL import has lower evidence coverage than repository import. Add design files or connect the source repository for stronger technical verification.",
    ],
    sellerRequired: ["Price", "Inventory", "Ships from", "Shipping profile", "Handling time", "Package weight"],
    aiEnhanced: false,
    generatedAt: new Date().toISOString(),
  };
}

