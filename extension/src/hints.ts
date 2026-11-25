// The schemas a document names, read from its prolog and root start tag
// with patterns rather than a parser, so they are found while the
// document is half typed and not well-formed.

export type OutlineLanguage = "rng" | "rnc" | "xsd";

export interface SchemaHint {
  language: OutlineLanguage;
  uri: string;
}

const RNG_NS = "http://relaxng.org/ns/structure/1.0";
const XS_NS = "http://www.w3.org/2001/XMLSchema";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

function pseudo(data: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of data.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]!] = m[2] ?? m[3] ?? "";
  return out;
}

function languageOf(href: string, typens: string | undefined): OutlineLanguage | undefined {
  const lower = href.toLowerCase();
  if (typens === XS_NS) return "xsd";
  if (typens === RNG_NS) return lower.endsWith(".rnc") ? "rnc" : "rng";
  if (typens) return undefined;
  if (lower.endsWith(".xsd")) return "xsd";
  if (lower.endsWith(".rng")) return "rng";
  if (lower.endsWith(".rnc")) return "rnc";
  return undefined;
}

/** The schemas to suggest from, with absolute URIs: the XSDs the root
 * names, else the first RELAX NG schema an `xml-model` names, as Urðr's
 * own schema outline chooses. */
export function schemaHints(text: string, resolve: (ref: string) => string): SchemaHint[] {
  const rootAt = text.search(/<[A-Za-z_]/);
  const prolog = rootAt < 0 ? text : text.slice(0, rootAt);
  const rng: SchemaHint[] = [];
  for (const m of prolog.matchAll(/<\?xml-model\s([\s\S]*?)\?>/g)) {
    const a = pseudo(m[1]!);
    if (!a["href"]) continue;
    const language = languageOf(a["href"], a["schematypens"]);
    if (language === "rng" || language === "rnc") rng.push({ language, uri: resolve(a["href"]) });
  }
  const xsd: SchemaHint[] = [];
  if (rootAt >= 0) {
    const end = text.indexOf(">", rootAt);
    const tag = text.slice(rootAt, end < 0 ? undefined : end);
    const attrs = pseudo(tag);
    const xsi = Object.entries(attrs).find(([k, v]) => k.startsWith("xmlns:") && v === XSI_NS)?.[0].slice(6) ?? "xsi";
    const none = attrs[`${xsi}:noNamespaceSchemaLocation`];
    if (none) xsd.push({ language: "xsd", uri: resolve(none.trim()) });
    const pairs = (attrs[`${xsi}:schemaLocation`] ?? "").trim().split(/\s+/).filter(Boolean);
    for (let i = 1; i < pairs.length; i += 2) xsd.push({ language: "xsd", uri: resolve(pairs[i]!) });
  }
  return xsd.length ? xsd : rng.slice(0, 1);
}
