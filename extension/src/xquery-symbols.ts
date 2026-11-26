// What an XQuery module declares and refers to, for code-nav.ts: its
// functions and global variables, the variables its clauses and
// functions bind, the modules it imports, and the functions and
// variables it uses. Read from the text with strings and comments
// blanked out, so that names in them don't count.
import { binds, expand, scanExpression, type Declaration, type Module, type Reference } from "./code-nav.ts";

const LOCAL = "http://www.w3.org/2005/xquery-local-functions";

/** The text with strings and comments replaced by spaces (the quotes
 * stay), so that offsets are unchanged. */
function blank(text: string): string {
  const out = text.split("");
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i]!;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && !(text[j] === c && text[j + 1] !== c)) j += text[j] === c ? 2 : 1;
      for (let k = i + 1; k < j && k < n; k++) if (out[k] !== "\n") out[k] = " ";
      i = j + 1;
    } else if (text.startsWith("(:", i)) {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth) {
        if (text.startsWith("(:", j)) (depth++, (j += 2));
        else if (text.startsWith(":)", j)) (depth--, (j += 2));
        else j++;
      }
      for (let k = i; k < j; k++) if (out[k] !== "\n") out[k] = " ";
      i = j;
    } else i++;
  }
  return out.join("");
}

/** Where the bracket `open` at `i` is closed in `s`, or the end. */
function closing(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === open) depth++;
    else if (s[j] === close && --depth === 0) return j;
  }
  return s.length;
}

const NAME = String.raw`[A-Za-z_À-￿][\w.\-·À-￿]*(?::[A-Za-z_À-￿][\w.\-·À-￿]*)?`;
const ANNOTATIONS = String.raw`(?:%\s*${NAME}\s*(?:\([^)]*\))?\s*)*`;

export function xqueryModule(text: string): Module {
  const masked = blank(text);
  const declarations: Declaration[] = [];
  const references: Reference[] = [];
  const imports: string[] = [];

  // Prefixes: declared, the module's own, and imported.
  const prefixes = new Map<string, string>([["local", LOCAL]]);
  for (const m of masked.matchAll(/\b(?:declare|module|import\s+(?:module|schema))\s+namespace\s+([\w.-]+)\s*=\s*(["'])/g)) {
    const at = m.index! + m[0].length;
    const end = masked.indexOf(m[2]!, at);
    prefixes.set(m[1]!, text.slice(at, end < 0 ? undefined : end));
  }
  const ns = (p: string) => prefixes.get(p);
  for (const m of masked.matchAll(/\bimport\s+module\s+(?:namespace\s+[\w.-]+\s*=\s*)?(["'])[^"']*\1\s*at\s+/g)) {
    const re = /\s*(["'])([^"']*)\1\s*(,)?/y;
    re.lastIndex = m.index! + m[0].length;
    let s: RegExpExecArray | null;
    while ((s = re.exec(masked))) {
      const start = s.index + s[0].indexOf(s[1]!) + 1;
      imports.push(text.slice(start, start + s[2]!.length));
      if (!s[3]) break;
    }
  }

  // Function bodies (declared and inline), for the scope of what they bind.
  const bodies: Array<{ start: number; end: number }> = [];
  const params: Array<{ start: number; end: number; body: { start: number; end: number } }> = [];
  const functionAt = (paren: number) => {
    const close = closing(masked, paren, "(", ")");
    // The body's "{", past "as" and a type that may hold parentheses.
    let j = close + 1;
    let depth = 0;
    while (j < masked.length) {
      const c = masked[j]!;
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (depth === 0 && (c === "{" || c === ";")) break;
      j++;
    }
    const body = masked[j] === "{" ? { start: j, end: closing(masked, j, "{", "}") } : { start: close, end: close };
    if (masked[j] === "{") bodies.push(body);
    params.push({ start: paren, end: close, body });
    return { close, body };
  };

  const declared = new Set<number>();
  for (const m of masked.matchAll(new RegExp(String.raw`\bdeclare\s+${ANNOTATIONS}function\s+(${NAME})\s*\(`, "g"))) {
    const name = m[1]!;
    const start = m.index! + m[0].lastIndexOf(name);
    declared.add(start);
    const paren = m.index! + m[0].length - 1;
    const { close, body } = functionAt(paren);
    const arity = [...masked.slice(paren, close).matchAll(/\$/g)].length;
    const semi = masked.indexOf(";", body.end);
    declarations.push({
      kind: "function",
      name: expand(name, ns, LOCAL),
      label: `${name}#${arity}`,
      start,
      end: start + name.length,
      fullStart: m.index!,
      fullEnd: semi < 0 ? body.end + 1 : semi + 1,
      arity,
    });
  }
  for (const m of masked.matchAll(/(?<![\w:.-])function\s*\(/g)) {
    if (!params.some((p) => p.start === m.index! + m[0].length - 1)) functionAt(m.index! + m[0].length - 1);
  }
  const globals = new Set<number>();
  for (const m of masked.matchAll(new RegExp(String.raw`\bdeclare\s+${ANNOTATIONS}variable\s+\$\s*(${NAME})`, "g"))) {
    const name = m[1]!;
    const start = m.index! + m[0].length - name.length;
    globals.add(start);
    const semi = masked.indexOf(";", start);
    declarations.push({ kind: "variable", name: expand(name, ns), label: `$${name}`, start, end: start + name.length, fullStart: m.index!, fullEnd: semi < 0 ? masked.length : semi + 1 });
  }

  const enclosing = (offset: number) =>
    bodies.filter((b) => b.start < offset && offset < b.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];

  for (const t of scanExpression(masked, 0)) {
    if (t.kind === "call") {
      if (declared.has(t.start)) continue;
      const colon = t.qname.indexOf(":");
      if (colon < 0) continue;
      references.push({ kind: "function", name: expand(t.qname, ns, LOCAL), start: t.start, end: t.end, arity: t.arity });
      continue;
    }
    if (globals.has(t.start)) continue;
    const name = expand(t.qname, ns);
    const param = params.find((p) => p.start < t.start && t.start < p.end);
    if (param || binds(masked, t.start, t.end)) {
      const scope = param ? { start: t.end, end: param.body.end } : { start: t.end, end: enclosing(t.start)?.end ?? masked.length };
      declarations.push({ kind: param ? "param" : "variable", name, label: `$${t.qname}`, start: t.start, end: t.end, fullStart: t.start - 1, fullEnd: t.end, scope });
    } else references.push({ kind: "variable", name, start: t.start, end: t.end });
  }
  return { declarations, references, imports };
}
