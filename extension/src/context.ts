// Where the cursor is in an XML document, for suggestions and hovers:
// which elements are open around it and what is being typed. Read from
// the text before the cursor, so it works on documents that are not
// well-formed yet.

export interface OpenElement {
  /** The name as written, such as `tei:p`. */
  qname: string;
  /** Its namespace, from the `xmlns` declarations in scope. */
  namespace: string;
  local: string;
  /** Prefix to namespace, for this element and its ancestors. */
  scope: Map<string, string>;
}

export type Place =
  /** After `<`, typing an element name (`partial` so far). */
  | { kind: "element"; partial: string; start: number }
  /** After `</`. */
  | { kind: "close"; partial: string; start: number }
  /** Inside a start tag, typing an attribute name. */
  | { kind: "attribute"; element: OpenElement; partial: string; start: number; present: string[] }
  /** Inside an attribute's quotes. */
  | { kind: "value"; element: OpenElement; attribute: string; partial: string; start: number }
  /** In text content. */
  | { kind: "text" };

export interface Context {
  /** Open elements, outermost first. */
  open: OpenElement[];
  place: Place;
}

const XML_NS = "http://www.w3.org/XML/1998/namespace";

function attributesOf(tag: string): [string, string][] {
  return [...tag.matchAll(/([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1]!, m[2] ?? m[3] ?? ""]);
}

function element(qname: string, tag: string, parent: Map<string, string>): OpenElement {
  const scope = new Map(parent);
  for (const [k, v] of attributesOf(tag)) {
    if (k === "xmlns") scope.set("", v);
    else if (k.startsWith("xmlns:")) scope.set(k.slice(6), v);
  }
  const colon = qname.indexOf(":");
  const prefix = colon < 0 ? "" : qname.slice(0, colon);
  return { qname, local: qname.slice(colon + 1), namespace: scope.get(prefix) ?? "", scope };
}

/** The expanded name of an attribute written `qname` on `e`: no prefix
 * means no namespace. */
export function attributeName(qname: string, e: OpenElement): [string, string] {
  const colon = qname.indexOf(":");
  if (colon < 0) return ["", qname];
  const prefix = qname.slice(0, colon);
  return [prefix === "xml" ? XML_NS : e.scope.get(prefix) ?? "", qname.slice(colon + 1)];
}

/** The context at `offset` in `text`. */
export function contextAt(text: string, offset: number): Context {
  const open: OpenElement[] = [];
  const root = new Map<string, string>([["xml", XML_NS]]);
  const scope = () => open[open.length - 1]?.scope ?? root;
  let i = 0;
  while (i < offset) {
    const lt = text.indexOf("<", i);
    if (lt < 0 || lt >= offset) break;
    const skip = (end: string, from: number) => {
      const j = text.indexOf(end, from);
      return j < 0 ? -1 : j + end.length;
    };
    let end: number;
    if (text.startsWith("<!--", lt)) end = skip("-->", lt + 4);
    else if (text.startsWith("<![CDATA[", lt)) end = skip("]]>", lt + 9);
    else if (text.startsWith("<?", lt)) end = skip("?>", lt + 2);
    else if (text.startsWith("<!", lt)) end = skip(">", lt + 2);
    else {
      // A tag: find its end, minding quotes.
      let quote = "";
      let j = lt + 1;
      for (; j < offset; j++) {
        const c = text[j]!;
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      if (j >= offset) {
        // The cursor is inside this tag.
        const tag = text.slice(lt, offset);
        if (tag.startsWith("</")) return { open, place: { kind: "close", partial: tag.slice(2), start: lt + 2 } };
        const name = /^<([^\s/>]*)/.exec(tag)![1]!;
        if (lt + 1 + name.length >= offset) return { open, place: { kind: "element", partial: name, start: lt + 1 } };
        const e = element(name, text.slice(lt, text.indexOf(">", offset) < 0 ? undefined : text.indexOf(">", offset)), scope());
        if (quote) {
          const m = /([^\s=]+)\s*=\s*["']([^"']*)$/.exec(tag)!;
          return { open, place: { kind: "value", element: e, attribute: m[1]!, partial: m[2]!, start: offset - m[2]!.length } };
        }
        const partial = /[^\s"'=]*$/.exec(tag)![0];
        const present = attributesOf(tag).map(([k]) => k);
        return { open, place: { kind: "attribute", element: e, partial, start: offset - partial.length, present } };
      }
      end = j + 1;
      const tag = text.slice(lt, end);
      if (tag.startsWith("</")) open.pop();
      else if (!tag.endsWith("/>")) {
        const name = /^<([^\s/>]+)/.exec(tag)?.[1];
        if (name) open.push(element(name, tag, scope()));
      }
    }
    if (end < 0 || end > offset) break;
    i = end;
  }
  return { open, place: { kind: "text" } };
}

/** The name at `offset` and what it names: an element in a start or end
 * tag, or an attribute in a start tag. */
export function nameAt(
  text: string,
  offset: number,
): { kind: "element" | "attribute"; qname: string; start: number; end: number; context: Context } | undefined {
  const before = /[\w:.-]*$/.exec(text.slice(0, offset))![0];
  const after = /^[\w:.-]*/.exec(text.slice(offset))![0];
  const start = offset - before.length;
  const qname = before + after;
  if (!qname) return undefined;
  const context = contextAt(text, start);
  const p = context.place;
  if (p.kind === "element" || p.kind === "close") return { kind: "element", qname, start, end: start + qname.length, context };
  if (p.kind === "attribute" && /^\s*=/.test(text.slice(start + qname.length))) {
    return { kind: "attribute", qname, start, end: start + qname.length, context };
  }
  return undefined;
}
