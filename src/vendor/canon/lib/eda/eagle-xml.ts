/**
 * A small, safe XML reader for EAGLE's design files (local addition, ../../NOTICE.md).
 *
 * EAGLE 6+ (and Fusion 360 Electronics' EAGLE export) write plain XML with a
 * `<!DOCTYPE eagle SYSTEM "eagle.dtd">` line. This reader is deliberately
 * narrow, so nothing in a file can make it do more than read the file:
 *
 * - no DTD is processed and none is fetched: a DOCTYPE with an internal subset
 *   (`[ … ]`) and any `<!ENTITY` declaration are refused (no XXE, no
 *   billion-laughs expansion);
 * - only XML's five predefined entities and numeric character references are
 *   decoded; any other `&name;` is an error, not a lookup;
 * - the input's size, the element count, the nesting depth and the attributes
 *   per element are capped, and the work is stopped past a deadline.
 *
 * Every refusal is an `EagleXmlError` with a code the caller reports.
 */
export type XmlElement = {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** The element's own character data, concatenated (EAGLE's `<text>` content). */
  text: string;
  /** 1-based line of the start tag, for the source map. */
  line: number;
};

export type XmlLimits = { maxChars: number; maxElements: number; maxDepth: number; maxAttributes: number; deadlineMs: number };

export const XML_LIMITS: XmlLimits = { maxChars: 60 * 1024 * 1024, maxElements: 3_000_000, maxDepth: 128, maxAttributes: 64, deadlineMs: 20_000 };

export type EagleXmlErrorCode = "XML_ENTITY_REFUSED" | "XML_DOCTYPE_REFUSED" | "XML_RESOURCE_LIMIT" | "XML_TIMEOUT" | "XML_SYNTAX";

export class EagleXmlError extends Error {
  constructor(
    readonly code: EagleXmlErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Decodes the five predefined entities and numeric references; anything else is refused. */
export function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&([^;&\s]{1,12});/g, (_, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      const code = Number.parseInt(name.slice(2), 16);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new EagleXmlError("XML_SYNTAX", `bad character reference &${name};`);
      return String.fromCodePoint(code);
    }
    if (name.startsWith("#")) {
      const code = Number.parseInt(name.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new EagleXmlError("XML_SYNTAX", `bad character reference &${name};`);
      return String.fromCodePoint(code);
    }
    const known = PREDEFINED[name];
    if (known === undefined) throw new EagleXmlError("XML_ENTITY_REFUSED", `entity &${name}; is not one of XML's predefined entities`);
    return known;
  });
}

const NAME_CHAR = /[A-Za-z0-9_:.\-$]/;

/** Parses an EAGLE XML document into its root element, under `limits`. */
export function parseXml(text: string, limits: XmlLimits = XML_LIMITS): XmlElement {
  if (text.length > limits.maxChars) throw new EagleXmlError("XML_RESOURCE_LIMIT", `document is larger than ${limits.maxChars} characters`);
  // Refused before anything else is read: an entity declaration anywhere, in or out of a DOCTYPE.
  if (/<!ENTITY/i.test(text)) throw new EagleXmlError("XML_ENTITY_REFUSED", "entity declarations are not read");
  const started = Date.now();
  const length = text.length;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let elements = 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const countLines = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  };
  const fail = (message: string): never => {
    throw new EagleXmlError("XML_SYNTAX", `${message} (line ${line})`);
  };

  while (index < length) {
    const open = text.indexOf("<", index);
    if (open < 0) {
      if (text.slice(index).trim() && stack.length) fail("unexpected end of document");
      break;
    }
    if (open > index) {
      const chunk = text.slice(index, open);
      const current = stack[stack.length - 1];
      if (current) current.text += decodeEntities(chunk);
      else if (chunk.trim()) fail("text outside the root element");
      countLines(index, open);
    }
    index = open;
    if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index + 4);
      if (end < 0) fail("unterminated comment");
      countLines(index, end);
      index = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", index)) {
      const end = text.indexOf("]]>", index + 9);
      if (end < 0) fail("unterminated CDATA section");
      const current = stack[stack.length - 1];
      if (current) current.text += text.slice(index + 9, end);
      countLines(index, end);
      index = end + 3;
      continue;
    }
    if (text.startsWith("<?", index)) {
      const end = text.indexOf("?>", index + 2);
      if (end < 0) fail("unterminated processing instruction");
      countLines(index, end);
      index = end + 2;
      continue;
    }
    if (text.startsWith("<!", index)) {
      // A DOCTYPE: an external identifier is accepted (and never fetched); an internal subset is refused.
      const end = text.indexOf(">", index + 2);
      if (end < 0) fail("unterminated declaration");
      const declaration = text.slice(index, end + 1);
      if (!/^<!DOCTYPE\s/i.test(declaration)) fail("unexpected declaration");
      if (declaration.includes("[")) throw new EagleXmlError("XML_DOCTYPE_REFUSED", "a DOCTYPE with an internal subset is not read");
      if (root || stack.length) fail("DOCTYPE after the root element");
      countLines(index, end);
      index = end + 1;
      continue;
    }
    if (text.startsWith("</", index)) {
      const end = text.indexOf(">", index + 2);
      if (end < 0) fail("unterminated end tag");
      const name = text.slice(index + 2, end).trim();
      const current = stack.pop();
      if (!current || current.name !== name) fail(`end tag </${name}> does not close <${current?.name ?? ""}>`);
      countLines(index, end);
      index = end + 1;
      continue;
    }
    // A start tag: its name, attributes, and whether it closes itself.
    let cursor = index + 1;
    while (cursor < length && NAME_CHAR.test(text[cursor]!)) cursor += 1;
    const name = text.slice(index + 1, cursor);
    if (!name) fail("element without a name");
    const element: XmlElement = { name, attrs: {}, children: [], text: "", line };
    let attributes = 0;
    let selfClosing = false;
    for (;;) {
      while (cursor < length && /\s/.test(text[cursor]!)) {
        if (text.charCodeAt(cursor) === 10) line += 1;
        cursor += 1;
      }
      if (cursor >= length) fail(`unterminated start tag <${name}>`);
      const c = text[cursor];
      if (c === ">") {
        cursor += 1;
        break;
      }
      if (c === "/" && text[cursor + 1] === ">") {
        selfClosing = true;
        cursor += 2;
        break;
      }
      const nameStart = cursor;
      while (cursor < length && NAME_CHAR.test(text[cursor]!)) cursor += 1;
      const attribute = text.slice(nameStart, cursor);
      if (!attribute) fail(`malformed attribute in <${name}>`);
      while (cursor < length && /\s/.test(text[cursor]!)) cursor += 1;
      if (text[cursor] !== "=") fail(`attribute ${attribute} without a value in <${name}>`);
      cursor += 1;
      while (cursor < length && /\s/.test(text[cursor]!)) cursor += 1;
      const quote = text[cursor];
      if (quote !== '"' && quote !== "'") fail(`attribute ${attribute} not quoted in <${name}>`);
      const close = text.indexOf(quote!, cursor + 1);
      if (close < 0) fail(`unterminated attribute ${attribute} in <${name}>`);
      const raw = text.slice(cursor + 1, close);
      if (raw.includes("<")) fail(`'<' in attribute ${attribute} of <${name}>`);
      countLines(cursor, close);
      attributes += 1;
      if (attributes > limits.maxAttributes) throw new EagleXmlError("XML_RESOURCE_LIMIT", `<${name}> has more than ${limits.maxAttributes} attributes`);
      element.attrs[attribute] = decodeEntities(raw);
      cursor = close + 1;
    }
    index = cursor;
    elements += 1;
    if (elements > limits.maxElements) throw new EagleXmlError("XML_RESOURCE_LIMIT", `more than ${limits.maxElements} elements`);
    if ((elements & 0xfff) === 0 && Date.now() - started > limits.deadlineMs) throw new EagleXmlError("XML_TIMEOUT", `not read within ${limits.deadlineMs} ms`);
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(element);
    else if (root) fail("a second root element");
    else root = element;
    if (!selfClosing) {
      stack.push(element);
      if (stack.length > limits.maxDepth) throw new EagleXmlError("XML_RESOURCE_LIMIT", `nesting deeper than ${limits.maxDepth}`);
    }
  }
  if (stack.length) fail(`<${stack[stack.length - 1]!.name}> is not closed`);
  if (!root) fail("no root element");
  return root!;
}

/** The first child element of that name. */
export const child = (element: XmlElement | undefined, name: string): XmlElement | undefined => element?.children.find((entry) => entry.name === name);
/** Every child element of that name. */
export const children = (element: XmlElement | undefined, name: string): XmlElement[] => (element ? element.children.filter((entry) => entry.name === name) : []);
/** The children of `parent > name`, e.g. `list(board, "elements")` for `<elements><element/>…</elements>`. */
export const list = (element: XmlElement | undefined, container: string): XmlElement[] => child(element, container)?.children ?? [];
