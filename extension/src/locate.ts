// Where a node that a validator path names sits in a document's text.
// Ported from Urðr Studio's editor (clients/studio/src/editor/xmlcheck.ts
// in silencesys/dh--urdr), so problems land on the same spot in both.

interface Step {
  attribute: boolean;
  local: string;
  position: number;
}

/** The steps of a path such as `/Q{urn:x}letters[1]/p:letter[2]/@n`. */
export function pathSteps(path: string): Step[] {
  const steps: Step[] = [];
  const re = /\/(@)?(?:Q\{[^}]*\})?(?:[^/:[\]{}@]+:)?([^/[\]{}@]+)(?:\[(\d+)\])?/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) steps.push({ attribute: !!m[1], local: m[2]!, position: Number(m[3] ?? 1) });
  return steps;
}

type Tag = { kind: "start" | "end" | "other"; start: number; end: number; empty: boolean };

/** The markup of well-formed XML: tags, comments, CDATA, PIs, DOCTYPE. */
function tags(text: string): Tag[] {
  const out: Tag[] = [];
  let i = text.indexOf("<");
  const until = (end: string, from: number) => {
    const j = text.indexOf(end, from);
    return j < 0 ? text.length : j + end.length;
  };
  while (i >= 0 && i < text.length) {
    let end: number;
    let kind: Tag["kind"] = "other";
    if (text.startsWith("<!--", i)) end = until("-->", i + 4);
    else if (text.startsWith("<![CDATA[", i)) end = until("]]>", i + 9);
    else if (text.startsWith("<?", i)) end = until("?>", i + 2);
    else if (text.startsWith("<!", i)) {
      // A DOCTYPE, with its internal subset in brackets.
      let depth = 0;
      let quote = "";
      end = i + 2;
      for (; end < text.length; end++) {
        const c = text[end]!;
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth === 0) break;
      }
      end++;
    } else {
      // A tag: `>` inside a quoted attribute value does not end it.
      let quote = "";
      end = i + 1;
      for (; end < text.length; end++) {
        const c = text[end]!;
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      end++;
      kind = text[i + 1] === "/" ? "end" : "start";
    }
    out.push({ kind, start: i, end, empty: text[end - 2] === "/" });
    i = text.indexOf("<", end);
  }
  return out;
}

function localName(qname: string): string {
  return qname.slice(qname.indexOf(":") + 1);
}

/** The range of the node a validator path names: its element's name in
 * the start tag, or its attribute's name. Elements are matched by local
 * name, which is how the text writes them whatever their namespace. */
export function locate(text: string, path: string): { start: number; end: number } | undefined {
  const steps = pathSteps(path);
  const elements = steps.filter((s) => !s.attribute);
  const attribute = steps.find((s) => s.attribute);
  if (!elements.length) return undefined;
  const seen: Map<string, number>[] = [new Map()];
  let matched = 0;
  let depth = 0;
  for (const t of tags(text)) {
    if (t.kind === "end") {
      seen.pop();
      if (matched === depth) matched--;
      depth--;
      continue;
    }
    if (t.kind !== "start") continue;
    const tag = text.slice(t.start, t.end);
    const qname = /^<([^\s/>]+)/.exec(tag)?.[1] ?? "";
    const name = localName(qname);
    const counts = seen[seen.length - 1]!;
    const n = (counts.get(name) ?? 0) + 1;
    counts.set(name, n);
    const step = elements[depth];
    const hit = matched === depth && step !== undefined && step.local === name && step.position === n;
    if (hit && depth + 1 === elements.length) {
      if (attribute) {
        const escaped = attribute.local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const a = new RegExp(`\\s((?:[^\\s=:]+:)?${escaped})\\s*=`).exec(tag);
        if (a) return { start: t.start + a.index + 1, end: t.start + a.index + 1 + a[1]!.length };
      }
      return { start: t.start + 1, end: t.start + 1 + qname.length };
    }
    if (t.empty) continue;
    depth++;
    seen.push(new Map());
    if (hit) matched++;
  }
  return undefined;
}
