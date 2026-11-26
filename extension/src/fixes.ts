// Quick fixes for schema problems, from the schema's outline at the
// problem's element rather than from the validator's message: add the
// required attributes a start tag lacks, change an element the parent
// does not allow to one it does, remove or change an attribute the
// element does not allow, and change a value to one the attribute takes.
import { attributeName, nameAt } from "./context.ts";
import { tagNames, type Edit } from "./elements.ts";
import { elementName, written, type Index, type Name } from "./suggest.ts";

export interface Fix {
  title: string;
  edits: Edit[];
  /** The one fix to apply with "Fix" when it is clearly right. */
  preferred?: boolean;
}

const key = (n: Name) => `${n[0]}\u0000${n[1]}`;
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** How many letters to add, remove or change to turn `a` into `b`. */
function distance(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}

/** The `max` names closest to `name`, closest first. */
function closest<T>(name: string, items: T[], label: (t: T) => string, max: number): T[] {
  return items
    .map((t) => ({ t, d: distance(name, label(t)) }))
    .sort((x, y) => x.d - y.d || label(x.t).localeCompare(label(y.t)))
    .slice(0, max)
    .map((x) => x.t);
}

/** Where a start tag's attributes end: before `/>` or `>`. */
function tagEnd(text: string, from: number): number | undefined {
  let quote = "";
  for (let j = from; j < text.length; j++) {
    const c = text[j]!;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return text[j - 1] === "/" ? j - 1 : j;
    else if (c === "<") return undefined;
  }
  return undefined;
}

/** The fixes for a problem whose range starts at `offset`, on an
 * element's or attribute's name. `expected` are the local names the
 * validator expected there, if it said: they come first. */
export function fixesAt(text: string, offset: number, index: Index, expected: string[] = []): Fix[] {
  const at = nameAt(text, offset);
  if (!at) return [];
  const { open, place } = at.context;
  const parent = open[open.length - 1];
  const fixes: Fix[] = [];

  if (at.kind === "element" && place.kind !== "close") {
    const name = elementName(text, at);
    const el = index.element(name);
    const end = tagEnd(text, at.end);
    // Required attributes the start tag lacks.
    if (el && end !== undefined) {
      const tag = text.slice(at.end, end);
      const own = new Map(parent?.scope ?? []);
      for (const m of tag.matchAll(/xmlns(?::([\w.-]+))?\s*=\s*["']([^"']*)["']/g)) own.set(m[1] ?? "", m[2]!);
      const present = new Set(
        [...tag.matchAll(/([^\s=<>/"']+)\s*=/g)].map((m) => {
          const q = m[1]!;
          const colon = q.indexOf(":");
          if (colon < 0) return key(["", q]);
          const prefix = q.slice(0, colon);
          return key([prefix === "xml" ? XML_NS : own.get(prefix) ?? "", q.slice(colon + 1)]);
        }),
      );
      const missing = el.attributes.filter((a) => a.required && !present.has(key(a.name)));
      const insert = (names: Name[]) => ({ start: end, end, text: names.map((n) => ` ${written(n, own)}=""`).join("") });
      for (const a of missing) {
        fixes.push({ title: `Add the required attribute ${written(a.name, own)}`, edits: [insert([a.name])], preferred: missing.length === 1 });
      }
      if (missing.length > 1) fixes.push({ title: "Add all required attributes", edits: [insert(missing.map((a) => a.name))], preferred: true });
    }
    // An element its parent does not allow: the allowed ones, closest
    // name first.
    const outer = parent ? index.of(parent) : undefined;
    const allowed = parent ? (outer && !outer.anyChildren ? outer.children : undefined) : index.outline.elements.filter((e) => e.top).map((e) => e.name);
    if (allowed && !allowed.some((n) => key(n) === key(name))) {
      const names = tagNames(text, at.start);
      if (names) {
        const first = allowed.filter((n) => expected.includes(n[1]));
        const rest = closest(
          name[1],
          allowed.filter((n) => !first.includes(n)),
          (n) => n[1],
          Math.max(0, 5 - first.length),
        );
        for (const n of [...first, ...rest]) {
          const to = written(n, parent?.scope);
          fixes.push({ title: `Change to <${to}>`, edits: names.map((r) => ({ ...r, text: to })), preferred: first.length === 1 && n === first[0] });
        }
      }
    }
  } else if (at.kind === "attribute" && place.kind === "attribute") {
    const el = index.of(place.element);
    const n = attributeName(at.qname, place.element);
    const isNamespace = at.qname === "xmlns" || at.qname.startsWith("xmlns:");
    const known = el?.attributes.find((a) => key(a.name) === key(n));
    const value = /^\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(text.slice(at.end));
    if (known && value && known.values.length && !known.values.includes(value[1] ?? value[2] ?? "")) {
      // A value the attribute does not take: the ones it does.
      const current = value[1] ?? value[2] ?? "";
      const start = at.end + value[0].length - 1 - current.length;
      for (const v of closest(current, known.values, (v) => v, 5)) {
        fixes.push({ title: `Change the value to "${v}"`, edits: [{ start, end: start + current.length, text: v }], preferred: known.values.length === 1 });
      }
    }
    if (el && !el.anyAttributes && !isNamespace && !el.attributes.some((a) => key(a.name) === key(n))) {
      // The attribute with its value and the space before it.
      const rest = /^\s*=\s*(?:"[^"]*"|'[^']*')/.exec(text.slice(at.end));
      const lead = /\s*$/.exec(text.slice(0, at.start))![0].length;
      if (rest) fixes.push({ title: `Remove the attribute ${at.qname}`, edits: [{ start: at.start - lead, end: at.end + rest[0].length, text: "" }] });
      const present = new Set(place.present.map((q) => key(attributeName(q, place.element))));
      const free = el.attributes.filter((a) => !present.has(key(a.name)));
      for (const a of closest(n[1], free, (a) => a.name[1], 3)) {
        const to = written(a.name, place.element.scope);
        fixes.push({ title: `Change to ${to}`, edits: [{ start: at.start, end: at.end, text: to }] });
      }
    }
  }
  return fixes;
}
