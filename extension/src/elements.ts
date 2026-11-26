// Elements in an XML text, for the editing actions (surround, delete
// tags, split, join, rename): the tags with their positions, matched
// into elements. Tolerant of documents being edited: a stray end tag is
// skipped and an element without one runs to the end.

export interface Tag {
  kind: "start" | "end" | "empty";
  name: string;
  /** The whole tag, `<` to `>`. */
  start: number;
  end: number;
  /** The name in it. */
  nameStart: number;
  nameEnd: number;
}

export interface Element {
  open: Tag;
  /** The end tag; none for `<x/>` or an element never closed. */
  close?: Tag;
  /** Where its content begins and ends (empty for `<x/>`). */
  contentStart: number;
  contentEnd: number;
  /** Where the element ends: after its end tag, or after `<x/>`. */
  end: number;
  depth: number;
}

const NAME_START = /[A-Za-z_:\u00C0-\uFFFF]/;
const NAME_CHAR = /[-.\w:\u00B7\u00C0-\uFFFF]/;

/** Every tag in `text`, in order. */
export function tags(text: string): Tag[] {
  const out: Tag[] = [];
  const skipTo = (from: number, close: string) => {
    const at = text.indexOf(close, from);
    return at < 0 ? text.length : at + close.length;
  };
  let i = text.indexOf("<");
  while (i >= 0 && i < text.length) {
    if (text.startsWith("<!--", i)) i = skipTo(i + 4, "-->");
    else if (text.startsWith("<![CDATA[", i)) i = skipTo(i + 9, "]]>");
    else if (text.startsWith("<?", i)) i = skipTo(i + 2, "?>");
    else if (text.startsWith("<!", i)) {
      // A DOCTYPE, perhaps with an internal subset in [ ].
      let j = i + 2;
      let depth = 0;
      while (j < text.length && !(text[j] === ">" && depth === 0)) {
        if (text[j] === "[") depth++;
        else if (text[j] === "]") depth--;
        else if (text[j] === '"' || text[j] === "'") j = Math.max(j, text.indexOf(text[j]!, j + 1));
        if (j < 0) j = text.length;
        j++;
      }
      i = j + 1;
    } else {
      const isEnd = text[i + 1] === "/";
      const nameStart = i + (isEnd ? 2 : 1);
      if (!NAME_START.test(text[nameStart] ?? "")) {
        i = text.indexOf("<", i + 1);
        continue;
      }
      let nameEnd = nameStart + 1;
      while (nameEnd < text.length && NAME_CHAR.test(text[nameEnd]!)) nameEnd++;
      // The tag ends at the first > outside quotes; another < first means
      // it was never finished.
      let j = nameEnd;
      let quote = "";
      while (j < text.length) {
        const c = text[j]!;
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">" || c === "<") break;
        j++;
      }
      if (text[j] !== ">") {
        i = j < text.length ? j : -1;
        continue;
      }
      const kind = isEnd ? "end" : text[j - 1] === "/" ? "empty" : "start";
      out.push({ kind, name: text.slice(nameStart, nameEnd), start: i, end: j + 1, nameStart, nameEnd });
      i = j + 1;
    }
    i = text.indexOf("<", i);
  }
  return out;
}

/** The elements of `text`, in document order. */
export function elements(text: string): Element[] {
  const out: Element[] = [];
  const stack: Element[] = [];
  for (const t of tags(text)) {
    if (t.kind === "empty") {
      out.push({ open: t, contentStart: t.end, contentEnd: t.end, end: t.end, depth: stack.length });
    } else if (t.kind === "start") {
      const e: Element = { open: t, contentStart: t.end, contentEnd: text.length, end: text.length, depth: stack.length };
      out.push(e);
      stack.push(e);
    } else {
      const at = stack.map((e) => e.open.name).lastIndexOf(t.name);
      if (at < 0) continue;
      const e = stack[at]!;
      // Elements opened inside it and never closed end here too.
      for (const inner of stack.splice(at)) {
        inner.contentEnd = t.start;
        inner.end = t.start;
      }
      e.close = t;
      e.end = t.end;
    }
  }
  return out;
}

/** The innermost element whose tags or content hold `offset`. */
export function elementAt(text: string, offset: number): Element | undefined {
  let best: Element | undefined;
  for (const e of elements(text)) {
    if (e.open.start < offset && offset < e.end && (!best || e.depth > best.depth)) best = e;
  }
  return best;
}

/** A change to the text: replace `start`..`end` with `text`. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Removes the tags of the element at `offset`, keeping its content.
 * An empty element goes entirely. */
export function deleteTags(text: string, offset: number): Edit[] | undefined {
  const e = elementAt(text, offset);
  if (!e) return undefined;
  if (!e.close) return e.open.kind === "empty" ? [{ start: e.open.start, end: e.open.end, text: "" }] : undefined;
  return [
    { start: e.close.start, end: e.close.end, text: "" },
    { start: e.open.start, end: e.open.end, text: "" },
  ];
}

/** The attributes of a start tag, as written, without `xml:id` and `id`,
 * which must not repeat. */
function attributesToCopy(text: string, tag: Tag): string {
  const inner = text.slice(tag.nameEnd, tag.end - (tag.kind === "empty" ? 2 : 1));
  return inner.replace(/\s+(?:xml:)?id\s*=\s*(?:"[^"]*"|'[^']*')/g, "").replace(/\s+$/, "");
}

/** Splits the element whose content holds `offset` into two, there: the
 * second gets the first's attributes, but not its id. Gives the edit and
 * where the caret goes. */
export function split(text: string, offset: number): { edit: Edit; caret: number } | undefined {
  let best: Element | undefined;
  for (const e of elements(text)) {
    if (e.close && e.contentStart <= offset && offset <= e.contentEnd && (!best || e.depth > best.depth)) best = e;
  }
  if (!best) return undefined;
  const name = best.open.name;
  const insert = `</${name}><${name}${attributesToCopy(text, best.open)}>`;
  return { edit: { start: offset, end: offset, text: insert }, caret: offset + insert.length };
}

const sameAttributes = (text: string, a: Tag, b: Tag) =>
  attributesToCopy(text, a).trim().split(/\s+/).sort().join(" ") === attributesToCopy(text, b).trim().split(/\s+/).sort().join(" ");

/** Joins the two sibling elements on either side of `offset` when they
 * have the same name and attributes: `<hi>a</hi> <hi>b</hi>` becomes
 * `<hi>a b</hi>`. The caret may be between them or in the tags that
 * meet. */
export function join(text: string, offset: number): Edit | undefined {
  const all = elements(text);
  for (let k = 0; k < all.length; k++) {
    const a = all[k]!;
    if (!a.close) continue;
    const b = all.find((x) => x.depth === a.depth && x.open.start >= a.end);
    if (!b || !b.close) continue;
    if (offset < a.close.start || offset > b.open.end) continue;
    const between = text.slice(a.end, b.open.start);
    if (between.trim() || b.open.name !== a.open.name || !sameAttributes(text, a.open, b.open)) return undefined;
    return { start: a.close.start, end: b.open.end, text: between ? " " : "" };
  }
  return undefined;
}

/** The names of the start and end tag of the element whose tag name
 * holds `offset`, for renaming both at once. */
export function tagNames(text: string, offset: number): Array<{ start: number; end: number }> | undefined {
  for (const e of elements(text)) {
    const ranges = [e.open, e.close].filter((t): t is Tag => t !== undefined).map((t) => ({ start: t.nameStart, end: t.nameEnd }));
    if (ranges.some((r) => r.start <= offset && offset <= r.end)) return e.open.kind === "empty" ? ranges.slice(0, 1) : e.close ? ranges : undefined;
  }
  return undefined;
}

/** The path of elements from the root to the caret at `offset`, such as
 * `/TEI/text/body/div[2]/p[3]`. Names are as written; a position is given
 * where the parent has more than one child of that name. Undefined
 * outside the root element. */
export function pathAt(text: string, offset: number): string | undefined {
  const all = elements(text);
  // Each element's parent, from the last open element one level up.
  const parent: Array<Element | undefined> = [];
  const lastAt: Element[] = [];
  for (const e of all) {
    parent.push(e.depth > 0 ? lastAt[e.depth - 1] : undefined);
    lastAt[e.depth] = e;
    lastAt.length = e.depth + 1;
  }
  let inner = -1;
  for (let k = 0; k < all.length; k++) {
    const e = all[k]!;
    if (e.open.start < offset && offset < e.end && (inner < 0 || e.depth > all[inner]!.depth)) inner = k;
  }
  if (inner < 0) return undefined;
  const chain: number[] = [];
  for (let k = inner; k >= 0; ) {
    chain.unshift(k);
    const up: Element | undefined = parent[k];
    k = up ? all.indexOf(up) : -1;
  }
  return chain
    .map((k) => {
      const e = all[k]!;
      const siblings = all.filter((x, j) => parent[j] === parent[k] && x.depth === e.depth && x.open.name === e.open.name);
      return siblings.length > 1 ? `/${e.open.name}[${siblings.indexOf(e) + 1}]` : `/${e.open.name}`;
    })
    .join("");
}

/** The element to select from the selection `start`..`end`: the
 * innermost element holding it, or, when the selection is already an
 * element or its content, the next one out. */
export function selectElement(text: string, start: number, end: number): { start: number; end: number } | undefined {
  let best: Element | undefined;
  for (const e of elements(text)) {
    const holds = e.open.start <= start && end <= e.end && (start < e.end || start < end) && !(e.open.start === start && e.end === end);
    if (holds && (!best || e.depth > best.depth)) best = e;
  }
  return best ? { start: best.open.start, end: best.end } : undefined;
}

/** Where Go to Matching Tag goes from `offset`: from a start tag to the
 * name in its end tag and back; elsewhere, to the start tag of the
 * element around. */
export function matchingTag(text: string, offset: number): number | undefined {
  let around: Element | undefined;
  for (const e of elements(text)) {
    if (e.open.start <= offset && offset < e.open.end) return e.close ? e.close.nameStart : e.open.nameStart;
    if (e.close && e.close.start <= offset && offset < e.close.end) return e.open.nameStart;
    if (e.open.start < offset && offset < e.end && (!around || e.depth > around.depth)) around = e;
  }
  return around?.open.nameStart;
}
