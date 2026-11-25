// Documentation that schemas carry for their elements and attributes:
// RELAX NG's `a:documentation` (as in the TEI schemas) and XSD's
// `xs:documentation`, read from the schema texts by pattern.

export interface Docs {
  elements: Map<string, string>;
  /** By attribute name; one text per name, the first found. */
  attributes: Map<string, string>;
}

function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The documentation in `texts`, by local name. */
export function readDocs(texts: string[]): Docs {
  const docs: Docs = { elements: new Map(), attributes: new Map() };
  const add = (map: Map<string, string>, name: string, doc: string) => {
    const local = name.slice(name.indexOf(":") + 1);
    if (doc && !map.has(local)) map.set(local, doc);
  };
  for (const text of texts) {
    // RELAX NG: <element name="p"> then <a:documentation>, before any
    // other pattern.
    for (const m of text.matchAll(
      /<(element|attribute)\s[^>]*?name="([^"]+)"[^>]*>\s*<[\w:]*documentation[^>]*>([\s\S]*?)<\/[\w:]*documentation>/g,
    )) {
      add(m[1] === "element" ? docs.elements : docs.attributes, m[2]!, clean(m[3]!));
    }
    // XSD: <xs:element name="x"><xs:annotation><xs:documentation>
    for (const m of text.matchAll(
      /<\w+:(element|attribute)\s[^>]*?name="([^"]+)"[^>]*>\s*<\w+:annotation[^>]*>\s*<\w+:documentation[^>]*>([\s\S]*?)<\/\w+:documentation>/g,
    )) {
      add(m[1] === "element" ? docs.elements : docs.attributes, m[2]!, clean(m[3]!));
    }
  }
  return docs;
}
