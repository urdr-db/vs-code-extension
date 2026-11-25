// Suggestions and hovers from a schema's outline, as Urðr Studio's editor
// makes them: the children an element may hold, its attributes, and the
// values they may take.
import { attributeName, contextAt, nameAt, type OpenElement } from "./context.ts";
import type { Docs } from "./docs.ts";
import { elements } from "./elements.ts";

export type Name = [string, string];

export interface OutlineAttribute {
  name: Name;
  required: boolean;
  values: string[];
}

export interface OutlineElement {
  name: Name;
  top: boolean;
  children: Name[];
  anyChildren: boolean;
  text: boolean;
  textValues: string[];
  attributes: OutlineAttribute[];
  anyAttributes: boolean;
}

export interface Outline {
  elements: OutlineElement[];
}

/** A suggestion, independent of the LSP types. */
export interface Suggestion {
  label: string;
  kind: "element" | "attribute" | "value" | "close";
  /** Snippet text, with tab stops. */
  insert: string;
  detail?: string;
  documentation?: string;
  /** Replace from this offset to the cursor. */
  start: number;
  /** Open suggestions again after inserting (for values). */
  retrigger?: boolean;
  required?: boolean;
  /** For an element: its namespace and local name. */
  name?: Name;
}

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const key = (n: Name) => `${n[0]}\u0000${n[1]}`;

export class Index {
  readonly outline: Outline;
  readonly docs: Docs;
  private byName = new Map<string, OutlineElement>();
  constructor(outline: Outline, docs: Docs) {
    this.outline = outline;
    this.docs = docs;
    for (const e of outline.elements) this.byName.set(key(e.name), e);
  }
  element(n: Name): OutlineElement | undefined {
    return this.byName.get(key(n));
  }
  /** What an open element is in the outline, if anything. */
  of(e: OpenElement | undefined): OutlineElement | undefined {
    return e ? this.element([e.namespace, e.local]) : undefined;
  }
}

/** How to write `n` where `scope` is in force: no prefix in the default
 * namespace, else a prefix bound to it, else its local name. */
function written(n: Name, scope: Map<string, string> | undefined): string {
  if (n[0] === XML_NS) return `xml:${n[1]}`;
  if (!scope || (scope.get("") ?? "") === n[0]) return n[1];
  for (const [p, u] of scope) if (p && u === n[0]) return `${p}:${n[1]}`;
  return n[1];
}

/** Escapes snippet syntax: dollar, closing brace and backslash. */
function escapeSnippet(s: string): string {
  return s.replace(/[$}\\]/g, (c) => "\\" + c);
}

export function suggest(text: string, offset: number, index: Index): Suggestion[] {
  const { open, place } = contextAt(text, offset);
  const parent = open[open.length - 1];
  switch (place.kind) {
    case "element": {
      const allowed = parent ? index.of(parent)?.children : index.outline.elements.filter((e) => e.top).map((e) => e.name);
      if (!allowed) return [];
      return allowed.map((n) => {
        const name = written(n, parent?.scope);
        const el = index.element(n);
        const required = (el?.attributes ?? []).filter((a) => a.required);
        let tab = 1;
        const attrs = required.map((a) => ` ${written(a.name, undefined)}="$${tab++}"`).join("");
        const empty = el !== undefined && !el.text && !el.children.length && !el.anyChildren;
        const insert = empty ? `${escapeSnippet(name)}${attrs}/>` : `${escapeSnippet(name)}${attrs}>$0</${escapeSnippet(name)}>`;
        return {
          label: name,
          kind: "element" as const,
          insert,
          detail: summary(el),
          documentation: index.docs.elements.get(n[1]),
          start: place.start,
          name: n,
        };
      });
    }
    case "close":
      return parent ? [{ label: parent.qname, kind: "close", insert: `${escapeSnippet(parent.qname)}>`, start: place.start }] : [];
    case "attribute": {
      const el = index.of(place.element);
      if (!el) return [];
      const present = new Set(place.present.map((q) => key(attributeName(q, place.element))));
      return el.attributes
        .filter((a) => !present.has(key(a.name)))
        .map((a) => {
          const name = written(a.name, place.element.scope);
          return {
            label: name,
            kind: "attribute" as const,
            insert: `${escapeSnippet(name)}="$1"`,
            detail: a.required ? "required" : a.values.length ? a.values.slice(0, 6).join(" | ") : undefined,
            documentation: index.docs.attributes.get(a.name[1]),
            start: place.start,
            retrigger: a.values.length > 0,
            required: a.required,
          };
        });
    }
    case "value": {
      const el = index.of(place.element);
      const n = attributeName(place.attribute, place.element);
      const a = el?.attributes.find((x) => key(x.name) === key(n));
      return (a?.values ?? []).map((v) => ({ label: v, kind: "value" as const, insert: escapeSnippet(v), start: place.start }));
    }
    case "text": {
      const el = index.of(parent);
      return (el?.textValues ?? []).map((v) => ({ label: v, kind: "value" as const, insert: escapeSnippet(v), start: offset }));
    }
  }
}

/** What a selection holds at its top level: the names of its elements,
 * and whether it has text. Undefined when it cuts through a tag or an
 * element, so that wrapping it would not be well-formed. */
export function selectionContent(text: string, start: number, end: number): { elements: Name[]; text: boolean } | undefined {
  const top: Array<{ start: number; end: number; qname: string; tag: string }> = [];
  for (const e of elements(text)) {
    if (e.open.start >= end || e.end <= start) continue;
    const inside = e.open.start >= start && e.end <= end;
    const around = e.contentStart <= start && end <= e.contentEnd;
    if (!inside && !around) return undefined;
    if (inside && (!top.length || e.open.start >= top[top.length - 1]!.end)) {
      top.push({ start: e.open.start, end: e.end, qname: e.open.name, tag: text.slice(e.open.start, e.open.end) });
    }
  }
  // The selection's parent gives the namespaces, and each element's own
  // xmlns declarations add to them.
  const scope = contextAt(text, start).open.at(-1)?.scope ?? new Map<string, string>();
  const names = top.map((t): Name => {
    const own = new Map(scope);
    for (const m of t.tag.matchAll(/xmlns(?::([\w.-]+))?\s*=\s*["']([^"']*)["']/g)) own.set(m[1] ?? "", m[2]!);
    const colon = t.qname.indexOf(":");
    return [own.get(colon < 0 ? "" : t.qname.slice(0, colon)) ?? "", t.qname.slice(colon + 1)];
  });
  let rest = "";
  let at = start;
  for (const t of top) {
    rest += text.slice(at, t.start);
    at = t.end;
  }
  rest += text.slice(at, end);
  const hasText = /\S/.test(rest.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, ""));
  return { elements: names, text: hasText };
}

/** Whether `el` may hold `content`, by its outline: every element in it
 * is a child it allows, and any text is allowed. Order and counts are not
 * checked. */
export function mayHold(el: OutlineElement | undefined, content: { elements: Name[]; text: boolean }): boolean {
  if (!el) return false;
  if (content.text && !el.text) return false;
  return el.anyChildren || content.elements.every((n) => el.children.some((c) => key(c) === key(n)));
}

function summary(el: OutlineElement | undefined): string | undefined {
  if (!el) return undefined;
  const required = el.attributes.filter((a) => a.required).map((a) => `@${a.name[1]}`);
  return required.length ? `needs ${required.join(", ")}` : undefined;
}

/** Hover text, in Markdown, for the element or attribute name at
 * `offset`, with its range. */
export function hover(text: string, offset: number, index: Index): { markdown: string; start: number; end: number } | undefined {
  const at = nameAt(text, offset);
  if (!at) return undefined;
  const { open, place } = at.context;
  const list = (names: string[], max = 25) =>
    names.length > max ? `${names.slice(0, max).join(", ")} and ${names.length - max} more` : names.join(", ");
  if (at.kind === "element") {
    const colon = at.qname.indexOf(":");
    const local = at.qname.slice(colon + 1);
    let ns: string;
    if (place.kind === "close") ns = open[open.length - 1]?.namespace ?? "";
    else {
      // The element's own xmlns declarations count too.
      const end = text.indexOf(">", at.end);
      const tag = text.slice(at.start, end < 0 ? undefined : end);
      const own = new Map(open[open.length - 1]?.scope ?? []);
      for (const m of tag.matchAll(/xmlns(?::([\w.-]+))?\s*=\s*["']([^"']*)["']/g)) own.set(m[1] ?? "", m[2]!);
      ns = own.get(colon < 0 ? "" : at.qname.slice(0, colon)) ?? "";
    }
    const el = index.element([ns, local]);
    if (!el) return undefined;
    const parts = [`**<${at.qname}>**`];
    const doc = index.docs.elements.get(local);
    if (doc) parts.push(doc);
    const attrs = el.attributes.map((a) => (a.required ? `**${a.name[1]}**` : a.name[1]));
    if (attrs.length) parts.push(`Attributes: ${list(attrs)}${el.anyAttributes ? ", and any other" : ""}`);
    const kids = el.children.map((c) => c[1]);
    if (kids.length || el.anyChildren) {
      parts.push(`May contain: ${list(kids)}${el.anyChildren ? (kids.length ? ", and any element" : "any element") : ""}${el.text ? ", and text" : ""}`);
    } else if (el.text) parts.push("May contain: text");
    return { markdown: parts.join("\n\n"), start: at.start, end: at.end };
  }
  if (place.kind !== "attribute") return undefined;
  const el = index.of(place.element);
  const n = attributeName(at.qname, place.element);
  const a = el?.attributes.find((x) => key(x.name) === key(n));
  if (!a) return undefined;
  const parts = [`**@${at.qname}**${a.required ? " (required)" : ""}`];
  const doc = index.docs.attributes.get(n[1]);
  if (doc) parts.push(doc);
  if (a.values.length) parts.push(`Values: ${list(a.values.map((v) => "`" + v + "`"))}`);
  return { markdown: parts.join("\n\n"), start: at.start, end: at.end };
}
