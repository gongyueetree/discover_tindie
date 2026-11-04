import "server-only";
import { fetchSignal, requestDeadline } from "./request-context";
import { createHash } from "node:crypto";
import { hasChinese, terminology } from "./english";
import type { Part } from "./types";
import { reserveTranslation } from "./limits";
const cache = new Map<string, string>();
/**
 * Optional standard Azure Translator v3 (NMT), never a generative/LLM endpoint. The only place that
 * calls Azure: every batch reserves the characters it actually sends (masked text) from the daily
 * budget first — the visitor's when `visitorKey` is given, otherwise the server's own share of the
 * site budget. Over budget (or without a working ledger) the glossary translation is used instead.
 */
export async function translateTexts(texts: string[], visitorKey: string | null = null, deadline = requestDeadline(20_000)): Promise<string[]> {
  const unique = [...new Set(texts.filter(hasChinese))];
  const pending = unique.filter(
    (t) => !cache.has(t) && hasChinese(terminology(t)),
  );
  if (process.env.AZURE_TRANSLATOR_KEY && pending.length) {
    for (let i = 0; i < pending.length; i += 40) {
      const batch = pending.slice(i, i + 40);
      try {
        const masks: Map<string, string>[] = [];
        const body = batch.map((t) => {
          const protectedTerms = new Map<string, string>();
          let index = 0;
          const masked = t.replace(
            /[A-Za-zµΩ°][A-Za-z0-9µΩ°+_.\/-]*|\d+(?:\.\d+)?/g,
            (token) => {
              const marker = "TINDIEKEEP" + index++ + "X";
              protectedTerms.set(marker, token);
              return marker;
            },
          );
          masks.push(protectedTerms);
          return { Text: masked };
        });
        // Not enough time left in this request: keep the glossary translation.
        if (deadline - Date.now() < 3_000) break;
        // Azure bills the characters submitted: reserve exactly those, before sending.
        if (!(await reserveTranslation(visitorKey, body.reduce((n, b) => n + b.Text.length, 0)))) break;
        // Reserving can itself be slow: check the time again right before sending.
        if (deadline - Date.now() < 2_000) break;
        const r = await fetch(
          "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=zh-Hans&to=en",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Ocp-Apim-Subscription-Key": process.env.AZURE_TRANSLATOR_KEY || "",
              ...(process.env.AZURE_TRANSLATOR_REGION
                ? {
                    "Ocp-Apim-Subscription-Region":
                      process.env.AZURE_TRANSLATOR_REGION,
                  }
                : {}),
            },
            body: JSON.stringify(body),
            signal: fetchSignal(Math.max(1_000, Math.min(15_000, deadline - Date.now() - 1_000))), // also aborts at the request deadline
            cache: "no-store",
          },
        );
        if (!r.ok) continue;
        const data = await r.json();
        batch.forEach((t, j) => {
          let translated = data[j]?.translations?.find(
            (v: any) => v.to === "en",
          )?.text;
          if (typeof translated !== "string") return;
          for (const [k, v] of masks[j]) {
            if (!translated.includes(k)) return;
            translated = translated.split(k).join(v);
          }
          if (!hasChinese(translated)) {
            if (cache.size > 5000) cache.clear();
            cache.set(t, translated);
          }
        });
      } catch {
        /* Preserve source text if provider cannot translate. */
      }
    }
  }
  return texts.map((t) => cache.get(t) || terminology(t));
}
export async function englishParts(parts: Part[], visitorKey: string | null = null, deadline?: number) {
  const strings = parts.flatMap((p) => [
    p.description,
    ...Object.entries(p.parameters).flat(),
  ]);
  const translated = await translateTexts(strings, visitorKey, deadline);
  let offset = 0;
  return parts.map((p) => {
    const description = translated[offset++];
    const parameters = Object.fromEntries(
      Object.entries(p.parameters).map(() => [
        translated[offset++],
        translated[offset++],
      ]),
    );
    const partial = [description, ...Object.entries(parameters).flat()].some(
      hasChinese,
    );
    return {
      ...p,
      description: hasChinese(description)
        ? "English description unavailable"
        : description,
      parameters: Object.fromEntries(
        Object.entries(parameters).map(([key, value], i) => [
          hasChinese(key)
            ? `Specification ${i + 1} (English label unavailable)`
            : key,
          hasChinese(value) ? "English value unavailable" : value,
        ]),
      ),
      originalText: { description: p.description, parameters: p.parameters },
      translation: {
        status: partial ? "partial" : "complete",
        method: process.env.AZURE_TRANSLATOR_KEY
          ? "terminology + machine translation"
          : "terminology",
        sourceHash: createHash("sha256")
          .update(JSON.stringify([p.description, p.parameters]))
          .digest("hex"),
      },
    };
  });
}

/** Translate display prose only; keep API IDs, URLs and source file paths untouched. */
export async function englishDisplay<T>(data: T): Promise<T> {
  const copy = JSON.parse(JSON.stringify(data));
  const slots: {
    target: Record<string, unknown>;
    key: string;
    text: string;
  }[] = [];
  function visit(v: unknown, parentKey = "") {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach((item) => visit(item, parentKey));
      return;
    }
    const o = v as Record<string, unknown>;
    for (const [k, value] of Object.entries(o)) {
      if (
        typeof value === "string" &&
        ([
          "title",
          "description",
          "projectName",
          "categoryName",
          "moduleName",
        ].includes(k) ||
          (k === "name" &&
            /^(category|categories|module|modules)$/.test(parentKey))) &&
        hasChinese(value)
      )
        slots.push({ target: o, key: k, text: value });
      else if (typeof value === "object") visit(value, k);
    }
  }
  visit(copy);
  const translated = await translateTexts(slots.map((s) => s.text));
  slots.forEach((s, i) => {
    s.target[s.key] = translated[i];
    s.target[s.key + "Original"] = s.text;
  });
  return copy;
}
