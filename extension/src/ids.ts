// TEI-style links between elements: `xml:id="p1"` names an element, and
// a `#p1` token in an attribute value (`ref`, `target`, `corresp`, `who`
// and the like) points to it. Used for going to an id, finding and
// renaming its uses, offering ids after `#`, and flagging ids that are
// missing or given twice.
import { tags } from "./elements.ts";

/** A span of the text: an id as written, without quotes or `#`. */
export interface IdSpan {
  id: string;
  start: number;
  end: number;
}

/** A pointer: `#id`, or `file.xml#id` for an id in another document. */
export interface Pointer extends IdSpan {
  /** The document part, as written; empty for the same document. */
  document: string;
}

export interface Links {
  ids: IdSpan[];
  pointers: Pointer[];
}

const ATTRIBUTE = /([^\s=<>/"']+)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/g;

/** The ids and pointers in `text`. */
export function links(text: string): Links {
  const ids: IdSpan[] = [];
  const pointers: Pointer[] = [];
  for (const t of tags(text)) {
    if (t.kind === "end") continue;
    const tag = text.slice(t.nameEnd, t.end);
    for (const m of tag.matchAll(ATTRIBUTE)) {
      const name = m[1]!;
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      const value = m[3] ?? m[4] ?? "";
      const valueStart = t.nameEnd + m.index + name.length + m[2]!.length + 1;
      if (name === "xml:id") {
        const lead = value.length - value.trimStart().length;
        ids.push({ id: value.trim(), start: valueStart + lead, end: valueStart + lead + value.trim().length });
        continue;
      }
      for (const w of value.matchAll(/\S+/g)) {
        const hash = w[0].indexOf("#");
        // A fragment that names an id: no scheme before it (no web
        // addresses), and something after it.
        if (hash < 0 || hash === w[0].length - 1 || /^[a-z][\w+.-]*:/i.test(w[0])) continue;
        const id = w[0].slice(hash + 1);
        if (!/^[\p{L}_][\p{L}\p{N}_.-]*$/u.test(id)) continue;
        const start = valueStart + w.index + hash + 1;
        pointers.push({ id, start, end: start + id.length, document: w[0].slice(0, hash) });
      }
    }
  }
  return { ids, pointers };
}

const within = (s: IdSpan, offset: number) => s.start <= offset && offset <= s.end;

/** The id at `offset`: an xml:id's value or a same-document pointer. */
export function idAt(l: Links, offset: number): { id: string; span: IdSpan; declaration: boolean } | undefined {
  const d = l.ids.find((s) => within(s, offset));
  if (d) return { id: d.id, span: d, declaration: true };
  const p = l.pointers.find((s) => within(s, offset) && !s.document);
  return p ? { id: p.id, span: p, declaration: false } : undefined;
}

/** Ids given twice, and pointers to ids the document does not have. */
export function idProblems(l: Links): Array<IdSpan & { message: string; severity: "error" | "warning" }> {
  const out: Array<IdSpan & { message: string; severity: "error" | "warning" }> = [];
  const seen = new Map<string, IdSpan>();
  for (const s of l.ids) {
    if (seen.has(s.id)) out.push({ ...s, severity: "error", message: `The id "${s.id}" is given twice; ids must be unique.` });
    else seen.set(s.id, s);
  }
  for (const p of l.pointers) {
    if (!p.document && !seen.has(p.id)) out.push({ ...p, severity: "warning", message: `No element has xml:id="${p.id}".` });
  }
  return out;
}
