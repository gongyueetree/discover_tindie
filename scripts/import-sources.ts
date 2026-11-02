import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { sources } from "../src/db/schema";

/* ----------------------------------------------------------------------------
   Curated source catalog for the discovery pipeline.

   Tiers (per the Source-Adapter strategy):
     - RSS  : native RSS/Atom feeds. status="active" -> the pipeline fetches them now.
     - API  : richer than RSS but each needs a custom adapter + key. status="paused"
              (recorded as roadmap; pipeline skips paused + non-RSS for now).
     - CRAWL: blog scraping, needs a crawler not available on serverless. status="paused".

   Re-runnable: skips any source whose name already exists (won't duplicate or
   overwrite ones you've edited in the admin).
---------------------------------------------------------------------------- */

type Seed = { name: string; method: "RSS" | "API" | "Crawl"; url: string; trust: "High" | "Medium" | "Low"; dailyCap: number; active: boolean };

const CATALOG: Seed[] = [
  // ---- Maker / project communities (native RSS) ----
  { name: "Hackaday",            method: "RSS", url: "https://hackaday.com/feed/",                         trust: "High",   dailyCap: 4, active: true },
  { name: "Hackster.io",         method: "RSS", url: "https://www.hackster.io/projects.atom",              trust: "High",   dailyCap: 3, active: true },
  { name: "Instructables Tech",  method: "RSS", url: "https://www.instructables.com/tag/type-id/category-technology/rss.xml", trust: "Medium", dailyCap: 2, active: true },
  { name: "Arduino Blog",        method: "RSS", url: "https://blog.arduino.cc/feed/",                       trust: "High",   dailyCap: 2, active: true },
  { name: "Adafruit Blog",       method: "RSS", url: "https://blog.adafruit.com/feed/",                     trust: "High",   dailyCap: 3, active: true },
  { name: "SparkFun News",       method: "RSS", url: "https://news.sparkfun.com/feeds/news",                trust: "High",   dailyCap: 2, active: true },
  { name: "Make Magazine",       method: "RSS", url: "https://makezine.com/feed/",                          trust: "Medium", dailyCap: 2, active: true },
  { name: "CNX Software",        method: "RSS", url: "https://www.cnx-software.com/feed/",                  trust: "Medium", dailyCap: 3, active: true },

  // ---- Embedded / firmware (native RSS) ----
  { name: "Espressif News",      method: "RSS", url: "https://www.espressif.com/en/news/rss.xml",           trust: "High",   dailyCap: 2, active: true },
  { name: "Raspberry Pi Blog",   method: "RSS", url: "https://www.raspberrypi.com/news/feed/",              trust: "High",   dailyCap: 2, active: true },
  { name: "Zephyr Blog",         method: "RSS", url: "https://www.zephyrproject.org/feed/",                 trust: "High",   dailyCap: 2, active: true },
  { name: "MicroPython",         method: "RSS", url: "https://micropython.org/feed.xml",                    trust: "High",   dailyCap: 1, active: true },

  // ---- PCB / EDA (native RSS) ----
  { name: "KiCad News",          method: "RSS", url: "https://www.kicad.org/blog/feed.xml",                 trust: "High",   dailyCap: 1, active: true },
  { name: "Crowd Supply Blog",   method: "RSS", url: "https://www.crowdsupply.com/feed",                    trust: "High",   dailyCap: 3, active: true },

  // ---- Reddit communities (native .rss) ----
  { name: "r/embedded",          method: "RSS", url: "https://www.reddit.com/r/embedded/.rss",              trust: "Medium", dailyCap: 2, active: true },
  { name: "r/electronics",       method: "RSS", url: "https://www.reddit.com/r/electronics/.rss",           trust: "Medium", dailyCap: 2, active: true },
  { name: "r/esp32",             method: "RSS", url: "https://www.reddit.com/r/esp32/.rss",                  trust: "Low",    dailyCap: 1, active: true },

  // ---- API tier (roadmap — recorded but paused until adapters exist) ----
  { name: "GitHub Trending (API)", method: "API", url: "https://api.github.com/search/repositories?q=topic:hardware&sort=updated", trust: "High", dailyCap: 3, active: false },
  { name: "Hackaday.io (API)",     method: "API", url: "https://api.hackaday.io/v1/projects/newest",         trust: "High", dailyCap: 3, active: false },
  { name: "Tindie New Products (API)", method: "API", url: "https://www.tindie.com/api/v1/product/new/",     trust: "High", dailyCap: 4, active: false },

  // ---- Crawl tier (roadmap — needs a crawler, paused) ----
  { name: "PCBWay Blog",         method: "Crawl", url: "https://www.pcbway.com/blog/",                       trust: "Medium", dailyCap: 1, active: false },
  { name: "JLCPCB Blog",         method: "Crawl", url: "https://jlcpcb.com/blog",                            trust: "Medium", dailyCap: 1, active: false },
];

async function main() {
  const existing = await db.select({ name: sources.name }).from(sources);
  const have = new Set(existing.map((s) => s.name.toLowerCase().trim()));

  let added = 0, skipped = 0;
  for (const s of CATALOG) {
    if (have.has(s.name.toLowerCase().trim())) { skipped++; continue; }
    await db.insert(sources).values({
      name: s.name,
      method: s.method,
      url: s.url,
      trust: s.trust,
      dailyCap: s.dailyCap,
      status: s.active ? "active" : "paused",
    });
    added++;
    console.log(`  + ${s.name}  [${s.method}, ${s.active ? "active" : "paused"}]`);
  }
  console.log(`\nDone. Added ${added}, skipped ${skipped} (already present).`);
  console.log("RSS sources are active and will be fetched on the next pipeline run.");
  console.log("API/Crawl sources were added as PAUSED (roadmap) — they need custom adapters before activation.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

