// An outline made from the names a document already uses, for
// suggestions where no schema is named, as Urðr Studio's editor offers
// them: the elements seen under each element, the attributes seen on it
// and the values those took. It has the same shape as a schema's outline
// (suggest.ts), so the same suggestions and hovers read it.
import { attributeName } from "./context.ts";
import { tags } from "./elements.ts";
import type { Name, Outline, OutlineAttribute, OutlineElement } from "./suggest.ts";

/** At most this many values are kept for an attribute; more than that is
 * free text, not a list to choose from. */
const MAX_VALUES = 30;
/** Values longer than this are free text too. */
const MAX_VALUE_LENGTH = 40;
/** Documents longer than this are read only this far. */
export const SCAN_LIMIT = 2_000_000;

const key = (n: Name) => `${n[0]}\u0000${n[1]}`;

interface Seen {
  name: Name;
  top: boolean;
  children: Map<string, Name>;
  text: boolean;
  attributes: Map<string, { name: Name; values: Set<string> | undefined }>;
}

/** The outline of the names `text` uses. The attributes of the tag
 * around `skip` (the one being typed in) are left out, so a half-typed
 * name or value is not suggested back. */
export function documentOutline(text: string, skip?: number): Outline {
  const source = text.length > SCAN_LIMIT ? text.slice(0, SCAN_LIMIT) : text;
  const seen = new Map<string, Seen>();
  const stack: Array<{ qname: string; name: Name }> = [];
  // The namespaces in force come from the same reading as suggestions;
  // reading the whole context at every tag would be slow, so the scope is
  // kept along the way.
  const scopes: Array<Map<string, string>> = [new Map([["xml", "http://www.w3.org/XML/1998/namespace"]])];
  let last = 0;
  for (const t of tags(source)) {
    const between = source.slice(last, t.start);
    last = t.end;
    const parent = stack.at(-1);
    if (parent && /\S/.test(between)) seen.get(key(parent.name))!.text = true;
    if (t.kind === "end") {
      const at = stack.map((s) => s.qname).lastIndexOf(t.name);
      if (at >= 0) {
        stack.splice(at);
        scopes.splice(at + 1);
      }
      continue;
    }
    // The tag being typed in: its attributes and values are half written.
    const typing = skip !== undefined && t.start < skip && skip < t.end;
    const tag = source.slice(t.start, t.end);
    const scope = new Map(scopes.at(-1)!);
    const attrs = [...tag.matchAll(/([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1]!, m[2] ?? m[3] ?? ""] as const);
    for (const [k, v] of attrs) {
      if (k === "xmlns") scope.set("", v);
      else if (k.startsWith("xmlns:")) scope.set(k.slice(6), v);
    }
    const colon = t.name.indexOf(":");
    const name: Name = [scope.get(colon < 0 ? "" : t.name.slice(0, colon)) ?? "", t.name.slice(colon + 1)];
    let s = seen.get(key(name));
    if (!s) {
      s = { name, top: false, children: new Map(), text: false, attributes: new Map() };
      seen.set(key(name), s);
    }
    if (parent) seen.get(key(parent.name))!.children.set(key(name), name);
    else s.top = true;
    const open = { qname: t.name, local: name[1], namespace: name[0], scope };
    for (const [k, v] of typing ? [] : attrs) {
      if (k === "xmlns" || k.startsWith("xmlns:")) continue;
      const an = attributeName(k, open);
      let a = s.attributes.get(key(an));
      if (!a) {
        a = { name: an, values: new Set() };
        s.attributes.set(key(an), a);
      }
      if (a.values) {
        if (v.length > MAX_VALUE_LENGTH || /\s/.test(v.trim()) || !v) {
          // Free text, or a list of tokens: not a value to pick.
          if (v.length > MAX_VALUE_LENGTH) a.values = undefined;
        } else {
          a.values.add(v);
          if (a.values.size > MAX_VALUES) a.values = undefined;
        }
      }
    }
    if (t.kind === "start") {
      stack.push({ qname: t.name, name });
      scopes.push(scope);
    }
  }
  // An element nothing was seen under yet may hold any name the document
  // uses: nothing says otherwise.
  const all = [...seen.values()].map((s) => s.name);
  const elements: OutlineElement[] = [...seen.values()].map((s) => ({
    name: s.name,
    top: s.top,
    children: s.children.size ? [...s.children.values()] : all,
    anyChildren: false,
    text: s.text,
    textValues: [],
    attributes: [...s.attributes.values()].map((a): OutlineAttribute => ({ name: a.name, required: false, values: a.values ? [...a.values].sort() : [] })),
    anyAttributes: true,
  }));
  return { elements };
}
