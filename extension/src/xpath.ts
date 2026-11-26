// "Evaluate XPath" on an open document: the expression runs as a small
// XSLT 3.0 stylesheet on the document, which answers in JSON with each
// item's path (for nodes) or value, so no separate XPath entry point is
// needed in the engine.

/** One item of the result. */
export interface XPathItem {
  /** For a node: its path, as fn:path gives it. */
  path?: string;
  kind?: string;
  name?: string;
  /** For a node, the start of its string value; for an atomic value, the
   * value. */
  text: string;
}

export interface XPathAnswer {
  count: number;
  items: XPathItem[];
  error?: string;
}

/** How many items come back; the count covers them all. */
export const MAX_ITEMS = 500;

const XSL = "http://www.w3.org/1999/XSL/Transform";
const TEI = "http://www.tei-c.org/ns/1.0";

const escapeAttribute = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");

/** The namespaces of the document's root element: its default one, and
 * its prefixes. */
export function rootNamespaces(text: string): { default: string; prefixes: Map<string, string> } {
  const prefixes = new Map<string, string>();
  let def = "";
  const root = /<([A-Za-z_][\w.:-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/.exec(text.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>/g, (m) => " ".repeat(m.length)));
  for (const m of (root?.[2] ?? "").matchAll(/(xmlns(?::([\w.-]+))?)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const uri = m[3] ?? m[4] ?? "";
    if (m[2]) prefixes.set(m[2], uri);
    else def = uri;
  }
  return { default: def, prefixes };
}

/** The stylesheet that evaluates `expression` on a document whose text is
 * `text`. Unprefixed names in the expression are in the root element's
 * default namespace, as in Oxygen; the root's prefixes are bound, and
 * `tei:` too in a TEI document. */
export function xpathStylesheet(expression: string, text: string): string {
  const ns = rootNamespaces(text);
  const bindings = new Map(ns.prefixes);
  if (ns.default === TEI && ![...bindings.values()].includes(TEI) && !bindings.has("tei")) bindings.set("tei", TEI);
  for (const [p, u] of [
    ["xs", "http://www.w3.org/2001/XMLSchema"],
    ["fn", "http://www.w3.org/2005/xpath-functions"],
    ["map", "http://www.w3.org/2005/xpath-functions/map"],
    ["array", "http://www.w3.org/2005/xpath-functions/array"],
    ["math", "http://www.w3.org/2005/xpath-functions/math"],
  ] as const) {
    if (!bindings.has(p)) bindings.set(p, u);
  }
  bindings.delete("xsl");
  const declarations = [...bindings].map(([p, u]) => ` xmlns:${p}="${escapeAttribute(u)}"`).join("");
  const item = `if ($i instance of node()) then map {
      'path': path($i),
      'kind': if ($i instance of element()) then 'element' else if ($i instance of attribute()) then 'attribute' else if ($i instance of text()) then 'text' else if ($i instance of comment()) then 'comment' else if ($i instance of processing-instruction()) then 'processing-instruction' else if ($i instance of document-node()) then 'document' else 'node',
      'name': name($i),
      'text': substring(normalize-space(string($i)), 1, 200)
    } else if ($i instance of map(*) or $i instance of array(*)) then map { 'text': serialize($i, map { 'method': 'json' }) }
    else if ($i instance of function(*)) then map { 'text': '(a function)' }
    else map { 'text': string($i) }`;
  return `<xsl:stylesheet xmlns:xsl="${XSL}"${declarations} version="3.0" xpath-default-namespace="${escapeAttribute(ns.default)}" exclude-result-prefixes="#all">
  <xsl:output method="json"/>
  <xsl:template match="/">
    <xsl:variable name="all" select="${escapeAttribute(expression)}"/>
    <xsl:sequence select="${escapeAttribute(`map { 'count': count($all), 'items': array { for $i in subsequence($all, 1, ${MAX_ITEMS}) return ${item} } }`)}"/>
  </xsl:template>
</xsl:stylesheet>`;
}

/** A path as fn:path gives it (`/Q{ns}TEI[1]/Q{ns}text[1]/@n`), as names
 * a person reads: `/TEI/text/@n`, keeping positions above 1. */
export function readablePath(path: string): string {
  return path.replace(/Q\{[^}]*\}/g, "").replace(/\[1\]/g, "") || "/";
}

/** The part of a path that names elements and an attribute, which
 * locate() can find: text(), comment() and the like name their parent. */
export function locatablePath(path: string): string {
  return path.replace(/\/(?:text|comment|processing-instruction|namespace)\([^)]*\)(?:\[\d+\])?$/, "");
}
