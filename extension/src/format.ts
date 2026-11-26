// Format and Indent, as in Oxygen XML Editor: every element that holds
// only elements (and comments and processing instructions) gets each
// child on its own line, indented one step deeper. An element that holds
// text is mixed content, such as a TEI <p>: it keeps its text and inline
// markup as written, and only its lines move with it. So do elements
// under xml:space="preserve" and xsl:text, whose whitespace counts, and
// CDATA. Tags, comments and the prolog are kept as written.
//
// Whether an element holds text is read from the text, and, where the
// document has a schema, from the schema as well: an element the schema
// lets hold text is kept as written even where this one holds none, as
// adding whitespace between its children would add text.

export interface FormatOptions {
  /** One step of indentation: a tab or some spaces. */
  indent: string;
  /** Whether the schema lets the element `local` in `namespace` hold
   * text; undefined when it does not say. */
  mixed?: (namespace: string, local: string) => boolean | undefined;
}

type Token =
  | { kind: "text" | "comment" | "pi" | "cdata" | "doctype"; start: number; end: number }
  | { kind: "start" | "end" | "empty"; start: number; end: number; name: string };

const NAME_START = /[A-Za-z_:\u00C0-\uFFFF]/;
const NAME_CHAR = /[-.\w:\u00B7\u00C0-\uFFFF]/;

/** The text as tokens, or undefined where it is not well-formed enough
 * to format safely (a tag never finished). */
function tokenize(text: string): Token[] | undefined {
  const out: Token[] = [];
  let i = 0;
  const upTo = (from: number, close: string) => {
    const at = text.indexOf(close, from);
    return at < 0 ? -1 : at + close.length;
  };
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt !== i) {
      const end = lt < 0 ? text.length : lt;
      out.push({ kind: "text", start: i, end });
      i = end;
      continue;
    }
    let end: number;
    let kind: Token["kind"];
    if (text.startsWith("<!--", i)) [kind, end] = ["comment", upTo(i + 4, "-->")];
    else if (text.startsWith("<![CDATA[", i)) [kind, end] = ["cdata", upTo(i + 9, "]]>")];
    else if (text.startsWith("<?", i)) [kind, end] = ["pi", upTo(i + 2, "?>")];
    else if (text.startsWith("<!", i)) {
      let j = i + 2;
      let depth = 0;
      while (j < text.length && !(text[j] === ">" && depth === 0)) {
        const c = text[j]!;
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === '"' || c === "'") {
          j = text.indexOf(c, j + 1);
          if (j < 0) return undefined;
        }
        j++;
      }
      [kind, end] = ["doctype", j < text.length ? j + 1 : -1];
    } else {
      const isEnd = text[i + 1] === "/";
      const nameStart = i + (isEnd ? 2 : 1);
      if (!NAME_START.test(text[nameStart] ?? "")) return undefined;
      let nameEnd = nameStart + 1;
      while (nameEnd < text.length && NAME_CHAR.test(text[nameEnd]!)) nameEnd++;
      let j = nameEnd;
      let quote = "";
      while (j < text.length) {
        const c = text[j]!;
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        else if (c === "<") return undefined;
        j++;
      }
      if (j >= text.length) return undefined;
      const tagKind = isEnd ? "end" : text[j - 1] === "/" ? "empty" : "start";
      out.push({ kind: tagKind, start: i, end: j + 1, name: text.slice(nameStart, nameEnd) });
      i = j + 1;
      continue;
    }
    if (end < 0) return undefined;
    out.push({ kind, start: i, end });
    i = end;
  }
  return out;
}

interface Node {
  token: Token;
  /** For an element with an end tag: the end tag, and what is between. */
  close?: Token;
  children?: Node[];
  /** Prefix to namespace, in force on this element. */
  scope?: Map<string, string>;
}

const XSLT_NS = "http://www.w3.org/1999/XSL/Transform";

function attributes(tag: string): [string, string][] {
  return [...tag.matchAll(/([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1]!, m[2] ?? m[3] ?? ""]);
}

/** The tokens as a tree, or undefined if the tags do not match. */
function tree(text: string, tokens: Token[]): Node[] | undefined {
  const root: Node[] = [];
  const stack: Node[] = [];
  const scopes: Map<string, string>[] = [new Map()];
  for (const token of tokens) {
    const siblings = stack.length ? stack[stack.length - 1]!.children! : root;
    if (token.kind === "start" || token.kind === "empty") {
      const scope = new Map(scopes[scopes.length - 1]);
      for (const [k, v] of attributes(text.slice(token.start, token.end))) {
        if (k === "xmlns") scope.set("", v);
        else if (k.startsWith("xmlns:")) scope.set(k.slice(6), v);
      }
      const node: Node = { token, scope };
      siblings.push(node);
      if (token.kind === "start") {
        node.children = [];
        stack.push(node);
        scopes.push(scope);
      }
    } else if (token.kind === "end") {
      const open = stack.pop();
      if (!open || (open.token as { name: string }).name !== token.name) return undefined;
      scopes.pop();
      open.close = token;
    } else siblings.push({ token });
  }
  return stack.length ? undefined : root;
}

const blank = (text: string, t: Token) => t.kind === "text" && !text.slice(t.start, t.end).trim();

/** The text formatted, or undefined if it is not well-formed enough to
 * format. */
export function format(text: string, options: FormatOptions): string | undefined {
  const tokens = tokenize(text);
  const nodes = tokens && tree(text, tokens);
  if (!nodes) return undefined;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const out: string[] = [];

  const nameOf = (n: Node): [string, string] => {
    const qname = (n.token as { name: string }).name;
    const colon = qname.indexOf(":");
    const prefix = colon < 0 ? "" : qname.slice(0, colon);
    return [n.scope?.get(prefix) ?? "", qname.slice(colon + 1)];
  };

  /** Whether an element is kept as written, with all it holds. */
  const keep = (n: Node): boolean => {
    const children = n.children!;
    if (!children.some((c) => c.token.kind !== "text")) return true;
    if (children.some((c) => c.token.kind === "cdata" || (c.token.kind === "text" && !blank(text, c.token)))) return true;
    const tag = text.slice(n.token.start, n.token.end);
    if (/\sxml:space\s*=\s*["']preserve["']/.test(tag)) return true;
    const [ns, local] = nameOf(n);
    if (ns === XSLT_NS && local === "text") return true;
    return options.mixed?.(ns, local) === true;
  };

  /** Where the line that `offset` is on begins its text. */
  const indentOf = (offset: number) => {
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    return /^[ \t]*/.exec(text.slice(lineStart, offset))![0];
  };

  /** Text written as it was, moved from `from` indentation to `to`: each
   * later line that began with the old indentation begins with the new. */
  const moved = (start: number, end: number, to: string, shift: boolean) => {
    const slice = text.slice(start, end);
    if (!shift || !slice.includes("\n")) return slice;
    const from = indentOf(start);
    return slice.replace(/\n([ \t]*)/g, (all, lead: string) => (lead.startsWith(from) ? `\n${to}${lead.slice(from.length)}` : all));
  };

  /** Whether the lines inside may be re-indented: not where whitespace
   * counts. */
  const shiftable = (n: Node) => {
    const tag = text.slice(n.token.start, n.token.end);
    if (/\sxml:space\s*=\s*["']preserve["']/.test(tag)) return false;
    const [ns, local] = nameOf(n);
    if (ns === XSLT_NS && local === "text") return false;
    return !text.slice(n.token.start, n.close?.end ?? n.token.end).includes("<![CDATA[");
  };

  const write = (n: Node, depth: number, preserve: boolean) => {
    const pad = options.indent.repeat(depth);
    const t = n.token;
    if (t.kind === "text") return;
    if (t.kind !== "start") {
      out.push(pad + moved(t.start, t.end, pad, !preserve && t.kind !== "cdata"));
      return;
    }
    const inPreserve = preserve || /\sxml:space\s*=\s*["']preserve["']/.test(text.slice(t.start, t.end));
    if (inPreserve || keep(n)) {
      out.push(pad + moved(t.start, n.close!.end, pad, !inPreserve && shiftable(n)));
      return;
    }
    out.push(pad + moved(t.start, t.end, pad, true));
    for (const c of n.children!) write(c, depth + 1, false);
    out.push(pad + text.slice(n.close!.start, n.close!.end));
  };

  for (const n of nodes) {
    if (n.token.kind === "text") {
      if (!blank(text, n.token)) return undefined;
      continue;
    }
    write(n, 0, false);
  }
  return (text.startsWith("\uFEFF") ? "\uFEFF" : "") + out.join(eol) + (/\r?\n$/.test(text) ? eol : "");
}
