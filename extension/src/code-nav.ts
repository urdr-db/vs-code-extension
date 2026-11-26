// Go to Definition, Find All References and the outline for XSLT and
// XQuery: what a module declares (templates, functions, variables,
// modes...) and what it refers to, read from its text by xsl-symbols.ts
// and xquery-symbols.ts, and the modules it includes or imports.

export type SymbolKind = "template" | "match" | "function" | "variable" | "param" | "mode" | "key" | "attribute-set";

/** Something a module declares. */
export interface Declaration {
  kind: SymbolKind;
  /** The expanded name, `Q{uri}local`; for a match template, its pattern. */
  name: string;
  /** As written. */
  label: string;
  /** Where the name is, and the whole declaration. */
  start: number;
  end: number;
  fullStart: number;
  fullEnd: number;
  /** A function's number of parameters. */
  arity?: number;
  /** Where a local variable or parameter can be used; none for a global. */
  scope?: { start: number; end: number };
  /** A match template's modes, as expanded names (`#default` for none). */
  modes?: string[];
  /** Shown next to the name in the outline. */
  detail?: string;
}

/** A use of a name. */
export interface Reference {
  kind: "template" | "function" | "variable" | "mode" | "key" | "attribute-set";
  name: string;
  start: number;
  end: number;
  /** A function call's number of arguments, when known. */
  arity?: number;
}

export interface Module {
  declarations: Declaration[];
  references: Reference[];
  /** The modules it includes or imports, as written (relative URIs). */
  imports: string[];
}

export interface Loaded {
  uri: string;
  text: string;
  module: Module;
}

export interface Place {
  uri: string;
  start: number;
  end: number;
}

/** Prefixes every XPath and XQuery processor knows. */
export const STANDARD_PREFIXES: Record<string, string> = {
  xml: "http://www.w3.org/XML/1998/namespace",
  xs: "http://www.w3.org/2001/XMLSchema",
  fn: "http://www.w3.org/2005/xpath-functions",
  math: "http://www.w3.org/2005/xpath-functions/math",
  map: "http://www.w3.org/2005/xpath-functions/map",
  array: "http://www.w3.org/2005/xpath-functions/array",
  err: "http://www.w3.org/2005/xqt-errors",
};

const QNAME = /[A-Za-z_À-￿][\w.\-·À-￿]*(?::[A-Za-z_À-￿][\w.\-·À-￿]*)?/y;

/** The expanded name of `qname`, its prefix looked up with `ns`; with no
 * prefix, in `unprefixed`. */
export function expand(qname: string, ns: (prefix: string) => string | undefined, unprefixed = ""): string {
  const colon = qname.indexOf(":");
  if (colon < 0) return `Q{${unprefixed}}${qname}`;
  const prefix = qname.slice(0, colon);
  return `Q{${ns(prefix) ?? STANDARD_PREFIXES[prefix] ?? `urn:unbound:${prefix}`}}${qname.slice(colon + 1)}`;
}

/** The variable uses and function calls in an expression, `$name` and
 * `prefix:name(…)` or `prefix:name#2`, skipping strings and comments.
 * `base` is where the expression starts in the module's text. Inside an
 * attribute, `&quot;` and `&apos;` may delimit strings too. */
export function scanExpression(
  expr: string,
  base: number,
): Array<{ kind: "variable" | "call"; qname: string; start: number; end: number; arity?: number; firstString?: string }> {
  const out: Array<{ kind: "variable" | "call"; qname: string; start: number; end: number; arity?: number; firstString?: string }> = [];
  const n = expr.length;
  // Where the string or comment starting at i ends, or i if none starts.
  const skip = (i: number): number => {
    const c = expr[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      for (;;) {
        const k = expr.indexOf(c, j);
        if (k < 0) return n;
        if (expr[k + 1] === c) j = k + 2;
        else return k + 1;
      }
    }
    for (const entity of ["&quot;", "&apos;"]) {
      if (expr.startsWith(entity, i)) {
        const k = expr.indexOf(entity, i + entity.length);
        return k < 0 ? n : k + entity.length;
      }
    }
    if (expr.startsWith("(:", i)) {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth) {
        if (expr.startsWith("(:", j)) (depth++, (j += 2));
        else if (expr.startsWith(":)", j)) (depth--, (j += 2));
        else j++;
      }
      return j;
    }
    return i;
  };
  // The number of arguments of the call whose "(" is at i.
  const arity = (i: number): number => {
    let depth = 0;
    let commas = 0;
    let any = false;
    for (let j = i; j < n; ) {
      const k = skip(j);
      if (k > j) {
        any = true;
        j = k;
        continue;
      }
      const c = expr[j]!;
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0) return any ? commas + 1 : 0;
      } else if (c === "," && depth === 1) commas++;
      else if (depth >= 1 && !/\s/.test(c)) any = true;
      j++;
    }
    return any ? commas + 1 : 0;
  };
  let i = 0;
  while (i < n) {
    const k = skip(i);
    if (k > i) {
      i = k;
      continue;
    }
    const c = expr[i]!;
    if (c === "$") {
      let j = i + 1;
      while (/\s/.test(expr[j] ?? "")) j++;
      QNAME.lastIndex = j;
      const m = QNAME.exec(expr);
      if (m) {
        out.push({ kind: "variable", qname: m[0], start: base + j, end: base + j + m[0].length });
        i = j + m[0].length;
        continue;
      }
    } else if (/[A-Za-z_À-￿]/.test(c) && !/[\w.\-$:@]/.test(expr[i - 1] ?? "")) {
      QNAME.lastIndex = i;
      const m = QNAME.exec(expr)!;
      const end = i + m[0].length;
      if (m[0].includes(":") && expr[end] !== ":") {
        let j = end;
        while (/\s/.test(expr[j] ?? "")) j++;
        if (expr[j] === "(" && expr[j + 1] !== ":") {
          const first = /^\(\s*(?:'([^']*)'|"([^"]*)"|&quot;(.*?)&quot;|&apos;(.*?)&apos;)/.exec(expr.slice(j));
          out.push({ kind: "call", qname: m[0], start: base + i, end: base + end, arity: arity(j), firstString: first ? first[1] ?? first[2] ?? first[3] ?? first[4] : undefined });
        } else if (expr[end] === "#") {
          const a = /^#(\d+)/.exec(expr.slice(end));
          if (a) out.push({ kind: "call", qname: m[0], start: base + i, end: base + end, arity: Number(a[1]) });
        }
      } else if (m[0] === "key" || m[0] === "fn:key") {
        // key('name', …): a use of the key.
        const first = /^\s*\(\s*(?:'([^']*)'|"([^"]*)"|&quot;(.*?)&quot;|&apos;(.*?)&apos;)/.exec(expr.slice(end));
        if (first) out.push({ kind: "call", qname: m[0], start: base + i, end: base + end, firstString: first[1] ?? first[2] ?? first[3] ?? first[4] });
      }
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

/** Whether the `$name` from `start` to `end` in `expr` binds the
 * variable (`for $x in`, `let $x :=`, `some $x in`, `at $i`) rather than
 * uses it. */
export function binds(expr: string, start: number, end: number): boolean {
  const before = expr.slice(Math.max(0, start - 40), start - 1);
  const after = expr.slice(end, end + 20);
  return /\b(?:let|for|some|every|at|count|start|end|previous|next|tumbling\s+window|sliding\s+window)\s*$/.test(before) || /^\s*(?::=|in\b)/.test(after);
}

/** The declaration a reference in `here` means, looking in the modules
 * `all` (here among them): the innermost local one in scope, else a
 * global one, here first. */
export function resolve(ref: Reference, here: Loaded, all: Loaded[]): Array<Declaration & { uri: string }> {
  const kinds: SymbolKind[] =
    ref.kind === "variable" ? ["variable", "param"] : ref.kind === "mode" ? ["mode"] : ref.kind === "function" ? ["function"] : [ref.kind];
  if (ref.kind === "variable") {
    const local = here.module.declarations
      .filter((d) => kinds.includes(d.kind) && d.name === ref.name && d.scope && d.scope.start <= ref.start && ref.start <= d.scope.end)
      .sort((a, b) => b.scope!.start - a.scope!.start)[0];
    if (local) return [{ ...local, uri: here.uri }];
  }
  const modules = [here, ...all.filter((m) => m.uri !== here.uri)];
  const out: Array<Declaration & { uri: string }> = [];
  for (const m of modules) {
    for (const d of m.module.declarations) {
      if (!kinds.includes(d.kind) || d.name !== ref.name || d.scope) continue;
      if (ref.kind === "function" && ref.arity !== undefined && d.arity !== undefined && d.arity !== ref.arity) continue;
      out.push({ ...d, uri: m.uri });
    }
  }
  // Without a declaration, a mode is still where the templates in it are.
  if (ref.kind === "mode") {
    for (const m of modules) {
      for (const d of m.module.declarations) if (d.kind === "match" && d.modes?.includes(ref.name)) out.push({ ...d, uri: m.uri });
    }
  }
  return ref.kind === "variable" ? out.slice(0, 1) : out;
}

/** What is at `offset` in `here`: a reference, or the name of a
 * declaration, as the reference it would be. */
function targetAt(here: Loaded, offset: number): { ref: Reference; declaration?: Declaration } | undefined {
  const ref = here.module.references.find((r) => r.start <= offset && offset <= r.end);
  if (ref) return { ref };
  const d = here.module.declarations.find((x) => x.start <= offset && offset <= x.end && x.kind !== "match");
  if (!d) return undefined;
  const kind = d.kind === "param" ? "variable" : (d.kind as Reference["kind"]);
  return { ref: { kind, name: d.name, start: d.start, end: d.end, arity: d.arity }, declaration: d };
}

/** Where what is at `offset` is declared. */
export function definitions(here: Loaded, offset: number, all: Loaded[]): Place[] {
  const t = targetAt(here, offset);
  if (!t || t.declaration) return [];
  return resolve(t.ref, here, all).map((d) => ({ uri: d.uri, start: d.start, end: d.end }));
}

/** Every use of what is at `offset`, in the modules `all`; with
 * `declarations`, where it is declared too. */
export function references(here: Loaded, offset: number, all: Loaded[], declarations: boolean): Place[] {
  const t = targetAt(here, offset);
  if (!t) return [];
  const targets = t.declaration ? [{ ...t.declaration, uri: here.uri }] : resolve(t.ref, here, all).filter((d) => d.kind !== "match");
  const same = (d: Declaration & { uri: string }) => targets.some((x) => x.uri === d.uri && x.start === d.start);
  const out: Place[] = declarations ? targets.map((d) => ({ uri: d.uri, start: d.start, end: d.end })) : [];
  const modules = [here, ...all.filter((m) => m.uri !== here.uri)];
  for (const m of modules) {
    for (const r of m.module.references) {
      if (r.kind !== t.ref.kind || r.name !== t.ref.name) continue;
      // A mode without a declaration: every use of its name.
      if (!targets.length || resolve(r, m, all).some(same)) out.push({ uri: m.uri, start: r.start, end: r.end });
    }
  }
  return out;
}

/** `uri` and the modules it includes or imports, and theirs, read with
 * `read`, at most `limit` of them. */
export async function load(
  uri: string,
  text: string,
  read: (uri: string) => Promise<string | undefined>,
  parse: (text: string) => Module,
  limit = 100,
): Promise<Loaded[]> {
  const out: Loaded[] = [];
  const seen = new Set<string>([uri]);
  const queue: Array<{ uri: string; text: string | undefined }> = [{ uri, text }];
  while (queue.length && out.length < limit) {
    const next = queue.shift()!;
    const t = next.text ?? (await read(next.uri).catch(() => undefined));
    if (t === undefined) continue;
    const module = parse(t);
    out.push({ uri: next.uri, text: t, module });
    for (const href of module.imports) {
      let target: string;
      try {
        target = new URL(href, next.uri).href;
      } catch {
        continue;
      }
      if (!seen.has(target)) {
        seen.add(target);
        queue.push({ uri: target, text: undefined });
      }
    }
  }
  return out;
}
