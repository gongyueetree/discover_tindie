import { sql } from "drizzle-orm";
import { db } from "../src/db";

/* ----------------------------------------------------------------------------
   Fix discoveries whose sourceName was mis-derived as "Www" (or similar junk)
   from a www.* domain. Re-derives the correct source name from sourceUrl.

   Run LOCALLY against the production DB:
     DATABASE_URL='...' npx tsx scripts/fix-source-names.ts

   The deriveSourceName() function below is the canonical logic — copy it into
   any ingest/scraper so new rows get correct names. (A Python port is provided
   in the comment at the bottom for non-TS scrapers.)
---------------------------------------------------------------------------- */

// Known domains -> brand display name. Extend as needed.
const KNOWN: Record<string, string> = {
  "hackaday.com": "Hackaday",
  "hackster.io": "Hackster.io",
  "instructables.com": "Instructables",
  "arduino.cc": "Arduino",
  "blog.arduino.cc": "Arduino",
  "adafruit.com": "Adafruit",
  "blog.adafruit.com": "Adafruit",
  "sparkfun.com": "SparkFun",
  "news.sparkfun.com": "SparkFun",
  "makezine.com": "Make",
  "cnx-software.com": "CNX Software",
  "espressif.com": "Espressif",
  "raspberrypi.com": "Raspberry Pi",
  "raspberrypi.org": "Raspberry Pi",
  "zephyrproject.org": "Zephyr Project",
  "micropython.org": "MicroPython",
  "kicad.org": "KiCad",
  "crowdsupply.com": "Crowd Supply",
  "reddit.com": "Reddit",
  "github.com": "GitHub",
  "tomshardware.com": "Tom's Hardware",
  "tweakers.net": "Tweakers",
  "theverge.com": "The Verge",
  "arstechnica.com": "Ars Technica",
  "engadget.com": "Engadget",
  "ieee.org": "IEEE",
  "spectrum.ieee.org": "IEEE Spectrum",
  "electronicsweekly.com": "Electronics Weekly",
  "eetimes.com": "EE Times",
  "allaboutcircuits.com": "All About Circuits",
  "hackedgadgets.com": "Hacked Gadgets",
  "tindie.com": "Tindie",
  "seeedstudio.com": "Seeed Studio",
  "jlcpcb.com": "JLCPCB",
  "pcbway.com": "PCBWay",
};

// Words that should stay all-caps if they appear as the main domain label.
const ACRONYMS = new Set(["pcb", "ai", "iot", "fpga", "diy", "usb", "rfid", "led"]);

function titleCaseLabel(label: string): string {
  if (ACRONYMS.has(label.toLowerCase())) return label.toUpperCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function deriveSourceName(rawUrl: string): string {
  let host: string;
  try { host = new URL(rawUrl).hostname.toLowerCase(); }
  catch { return "Unknown source"; }

  // Strip a leading "www."
  host = host.replace(/^www\./, "");

  // Exact known-domain match first.
  if (KNOWN[host]) return KNOWN[host];

  // Try the registrable domain (last two labels) against KNOWN, e.g. blog.x.com -> x.com
  const labels = host.split(".");
  if (labels.length >= 2) {
    const registrable = labels.slice(-2).join(".");
    if (KNOWN[registrable]) return KNOWN[registrable];
  }

  // Fallback: take the main domain label (the one before the TLD) and title-case it.
  // e.g. "tomshardware.com" -> "tomshardware" -> "Tomshardware"
  //      "blog.example.co.uk" -> "example"
  let main = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  // handle simple second-level TLDs like co.uk / com.cn
  if (labels.length >= 3 && /^(co|com|org|net|gov|ac)$/.test(labels[labels.length - 2])) {
    main = labels[labels.length - 3];
  }
  return titleCaseLabel(main);
}

async function main() {
  const rows: any = await db.execute(sql`
    SELECT id, title, source_url, source_name
    FROM discoveries
    WHERE source_name IN ('Www', 'www', 'Unknown source', '') OR source_name IS NULL
  `);
  const list = rows.rows ?? rows;
  console.log(`Found ${list.length} discoveries with a bad source name.`);

  let fixed = 0, skipped = 0;
  for (const r of list) {
    if (!r.source_url) { console.log(`  - skip #${r.id} (no source_url): ${r.title}`); skipped++; continue; }
    const name = deriveSourceName(r.source_url);
    await db.execute(sql`UPDATE discoveries SET source_name = ${name} WHERE id = ${r.id}`);
    console.log(`  ok #${r.id}  "${r.source_name}" -> "${name}"  (${r.source_url})`);
    fixed++;
  }
  console.log(`\nDone. Fixed ${fixed}, skipped ${skipped}.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

/* ---------------------------------------------------------------------------
   PYTHON PORT (for the scraper that writes via the ingest API) — same logic:

   from urllib.parse import urlparse

   KNOWN = {
       "tomshardware.com": "Tom's Hardware",
       "tweakers.net": "Tweakers",
       "hackaday.com": "Hackaday",
       # ... keep in sync with the TS dict above ...
   }
   ACRONYMS = {"pcb", "ai", "iot", "fpga", "diy", "usb", "rfid", "led"}

   def derive_source_name(raw_url: str) -> str:
       try:
           host = urlparse(raw_url).hostname.lower()
       except Exception:
           return "Unknown source"
       host = host.removeprefix("www.")           # <-- the key fix
       if host in KNOWN:
           return KNOWN[host]
       labels = host.split(".")
       if len(labels) >= 2 and ".".join(labels[-2:]) in KNOWN:
           return KNOWN[".".join(labels[-2:])]
       main = labels[-2] if len(labels) >= 2 else labels[0]
       if len(labels) >= 3 and labels[-2] in ("co","com","org","net","gov","ac"):
           main = labels[-3]
       return main.upper() if main in ACRONYMS else main.capitalize()
--------------------------------------------------------------------------- */

