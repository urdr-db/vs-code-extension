// What an XSLT module declares and refers to, for code-nav.ts: named and
// match templates, functions, variables and parameters (global and
// local), modes, keys and attribute sets; and the calls, $variables,
// modes, keys and attribute sets used, in the attributes that hold XPath,
// in attribute value templates, and in text value templates under
// expand-text="yes".
import { binds, expand, scanExpression, type Declaration, type Module, type Reference } from "./code-nav.ts";
import { elements } from "./elements.ts";

const XSLT_NS = "http://www.w3.org/1999/XSL/Transform";

/** Attributes of XSLT instructions that hold an expression or pattern. */
const XPATH = new Set([
  "select",
  "test",
  "match",
  "use",
  "group-by",
  "group-adjacent",
  "group-starting-with",
  "group-ending-with",
  "value",
  "count",
  "from",
  "initial-value",
  "context-item",
  "xpath",
  "with-params",
  "for-each-item",
  "for-each-source",
  "namespace-context",
]);

interface Attribute {
  name: string;
  value: string;
  /** Where the value starts in the text. */
  start: number;
}

function attributes(text: string, start: number, end: number): Attribute[] {
  const tag = text.slice(start, end);
  return [...tag.matchAll(/([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => {
    const value = m[2] ?? m[3] ?? "";
    return { name: m[1]!, value, start: start + m.index! + m[0].length - 1 - value.length };
  });
}

/** The parts of an attribute value template between `{` and `}`, with
 * where each starts, skipping `{{` and `}}`. */
function templateParts(value: string, start: number): Array<{ expr: string; start: number }> {
  const out: Array<{ expr: string; start: number }> = [];
  let i = 0;
  while (i < value.length) {
    if (value.startsWith("{{", i) || value.startsWith("}}", i)) {
      i += 2;
      continue;
    }
    if (value[i] === "{") {
      // The closing brace, past strings and nested braces.
      let depth = 1;
      let j = i + 1;
      let quote = "";
      while (j < value.length && depth) {
        const c = value[j]!;
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === "'" || c === '"') quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        j++;
      }
      out.push({ expr: value.slice(i + 1, j - 1), start: start + i + 1 });
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

export function xslModule(text: string): Module {
  const all = elements(text);
  const declarations: Declaration[] = [];
  const references: Reference[] = [];
  const imports: string[] = [];

  // Each element's parent, namespaces in scope and expand-text.
  const parent: Array<number | undefined> = [];
  const scopes: Array<Map<string, string>> = [];
  const expandText: boolean[] = [];
  const lastAt: number[] = [];
  all.forEach((e, k) => {
    const up = e.depth > 0 ? lastAt[e.depth - 1] : undefined;
    parent.push(up);
    lastAt[e.depth] = k;
    lastAt.length = e.depth + 1;
    const scope = new Map(up !== undefined ? scopes[up] : []);
    for (const a of attributes(text, e.open.nameEnd, e.open.end)) {
      if (a.name === "xmlns") scope.set("", a.value);
      else if (a.name.startsWith("xmlns:")) scope.set(a.name.slice(6), a.value);
    }
    scopes.push(scope);
    const colon = e.open.name.indexOf(":");
    const isXsl = scope.get(colon < 0 ? "" : e.open.name.slice(0, colon)) === XSLT_NS;
    const own = attributes(text, e.open.nameEnd, e.open.end).find((a) => a.name === (isXsl ? "expand-text" : "xsl:expand-text"));
    expandText.push(own ? ["yes", "true", "1"].includes(own.value.trim()) : up !== undefined ? expandText[up]! : false);
  });

  const xslName = (k: number): string | undefined => {
    const e = all[k]!;
    const colon = e.open.name.indexOf(":");
    return scopes[k]!.get(colon < 0 ? "" : e.open.name.slice(0, colon)) === XSLT_NS ? e.open.name.slice(colon + 1) : undefined;
  };

  all.forEach((e, k) => {
    const scope = scopes[k]!;
    const ns = (p: string) => scope.get(p);
    const local = xslName(k);
    const attrs = attributes(text, e.open.nameEnd, e.open.end);
    const attr = (name: string) => attrs.find((a) => a.name === name);
    const expr = (source: string, start: number) => {
      for (const t of scanExpression(source, start)) {
        if (t.kind === "variable") {
          const name = expand(t.qname, ns);
          // A variable the expression binds itself, for the rest of it.
          if (binds(source, t.start - start, t.end - start)) {
            declarations.push({ kind: "variable", name, label: t.qname, start: t.start, end: t.end, fullStart: t.start - 1, fullEnd: t.end, scope: { start: t.end, end: start + source.length } });
          } else references.push({ kind: "variable", name, start: t.start, end: t.end });
        }
        else if ((t.qname === "key" || t.qname === "fn:key") && t.firstString !== undefined) {
          const at = source.indexOf(t.firstString, t.end - start);
          references.push({ kind: "key", name: expand(t.firstString.trim(), ns), start: start + at, end: start + at + t.firstString.length });
        } else if (t.qname.includes(":")) references.push({ kind: "function", name: expand(t.qname, ns), start: t.start, end: t.end, arity: t.arity });
      }
    };
    /** Each name in a space-separated list, as a reference. */
    const names = (a: Attribute | undefined, kind: Reference["kind"], skip: RegExp = /^#/) => {
      if (!a) return;
      for (const m of a.value.matchAll(/\S+/g)) if (!skip.test(m[0])) references.push({ kind, name: expand(m[0], ns), start: a.start + m.index!, end: a.start + m.index! + m[0].length });
    };

    // The attributes: XPath, attribute value templates, or names.
    for (const a of attrs) {
      if (a.name === "xmlns" || a.name.startsWith("xmlns:")) continue;
      if (local !== undefined && XPATH.has(a.name)) expr(a.value, a.start);
      else if (local === undefined || !["name", "mode", "as", "href", "use-attribute-sets", "version", "exclude-result-prefixes", "extension-element-prefixes"].includes(a.name)) {
        for (const p of templateParts(a.value, a.start)) expr(p.expr, p.start);
      }
    }
    // Text value templates.
    if (expandText[k] && e.close) {
      let at = e.contentStart;
      for (const child of all.filter((c, j) => parent[j] === k)) {
        for (const p of templateParts(text.slice(at, child.open.start), at)) expr(p.expr, p.start);
        at = child.end;
      }
      for (const p of templateParts(text.slice(at, e.contentEnd), at)) expr(p.expr, p.start);
    }
    names(local === undefined ? attr("xsl:use-attribute-sets") : attr("use-attribute-sets"), "attribute-set");
    if (local === undefined) return;

    const name = attr("name");
    const full = { fullStart: e.open.start, fullEnd: e.end };
    const declare = (kind: Declaration["kind"], extra: Partial<Declaration> = {}) => {
      if (!name) return;
      declarations.push({ kind, name: expand(name.value.trim(), ns), label: name.value.trim(), start: name.start, end: name.start + name.value.length, ...full, ...extra });
    };
    const isTop = parent[k] !== undefined && parent[k] === 0 && all[0] && xslName(0) !== undefined;
    switch (local) {
      case "include":
      case "import": {
        const href = attr("href");
        if (href) imports.push(href.value);
        break;
      }
      case "template": {
        const mode = attr("mode");
        names(mode, "mode");
        const modes = mode ? mode.value.split(/\s+/).filter(Boolean).map((m) => (m.startsWith("#") ? m : expand(m, ns))) : ["#default"];
        if (name) declare("template");
        const match = attr("match");
        if (match) {
          declarations.push({
            kind: "match",
            name: match.value,
            label: match.value,
            start: match.start,
            end: match.start + match.value.length,
            ...full,
            modes,
            detail: mode ? `mode ${mode.value}` : undefined,
          });
        }
        break;
      }
      case "function": {
        const params = all.filter((c, j) => parent[j] === k && xslName(j) === "param").length;
        declare("function", { arity: params, label: `${name?.value.trim()}#${params}` });
        break;
      }
      case "variable":
      case "param": {
        if (isTop) declare(local);
        else if (parent[k] !== undefined) {
          // Visible in the following siblings and what they hold.
          const up = all[parent[k]!]!;
          declare(local, { scope: { start: e.end, end: up.contentEnd } });
        }
        break;
      }
      case "mode":
      case "key":
      case "attribute-set":
        declare(local);
        break;
      case "call-template":
        if (name) references.push({ kind: "template", name: expand(name.value.trim(), ns), start: name.start, end: name.start + name.value.length });
        break;
      case "apply-templates":
        names(attr("mode"), "mode");
        break;
    }
  });
  return { declarations, references, imports };
}
