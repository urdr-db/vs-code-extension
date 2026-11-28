// What an XQuery file suggests, as Urðr Studio's query editor does:
// keywords, the engine's built-in functions, the functions and global
// variables the module and the modules it imports declare, and the
// variables in scope at the cursor. Database paths inside
// `collection("…")`, which Studio also offers, need a server and are left
// out.
import type { Loaded } from "./code-nav.ts";

/** A built-in function, from the engine's own table (`builtinFunctions`
 * of the core). */
export interface Builtin {
  prefix: string;
  name: string;
  namespace: string;
  /** The counts of arguments it takes, below `variadicFrom`. */
  arities: number[];
  /** It takes this many arguments or more (`fn:concat`). */
  variadicFrom: number | null;
}

export interface QuerySuggestion {
  label: string;
  kind: "keyword" | "function" | "variable" | "prefix";
  /** Snippet text, with tab stops. */
  insert: string;
  detail?: string;
  documentation?: string;
  /** Replace from this offset to the cursor. */
  start: number;
  /** Open suggestions again after inserting (after a prefix). */
  retrigger?: boolean;
  /** Lower comes first. */
  rank: number;
}

export const KEYWORDS = [...new Set([
  "allowing", "ancestor", "ancestor-or-self", "and", "as", "ascending", "at", "attribute", "case", "cast", "castable",
  "catch", "child", "collation", "comment", "construction", "context", "copy-namespaces", "count", "declare",
  "default", "descendant", "descendant-or-self", "descending", "div", "document", "document-node", "element",
  "else", "empty", "empty-sequence", "encoding", "end", "eq", "every", "except", "external", "following",
  "following-sibling", "for", "function", "ge", "greatest", "group", "gt", "idiv", "if", "import", "in",
  "instance", "intersect", "is", "item", "lax", "le", "least", "let", "lt", "map", "array", "mod", "module",
  "namespace", "namespace-node", "ne", "next", "node", "of", "only", "option", "or", "order", "ordered",
  "ordering", "parent", "preceding", "preceding-sibling", "previous", "processing-instruction", "return",
  "satisfies", "schema", "schema-attribute", "schema-element", "self", "sliding", "some", "stable", "start",
  "strict", "switch", "text", "then", "to", "treat", "try", "tumbling", "typeswitch", "union", "unordered",
  "validate", "variable", "version", "when", "where", "window", "xquery",
  // XQuery Update Facility.
  "copy", "modify", "insert", "delete", "replace", "rename", "into", "first", "last", "before", "after",
  "with", "value", "nodes",
])];

/** Prefixes of Urðr's own functions, which do their work in the database. */
const URDR_PREFIXES = new Set(["ft", "validate", "xpath", "urdr", "file"]);

/** Escapes snippet syntax: dollar, closing brace and backslash. */
const escapeSnippet = (s: string) => s.replace(/[$}\\]/g, (c) => "\\" + c);

function arityText(arities: number[], variadicFrom: number | null): string {
  const counts = arities.map(String);
  if (variadicFrom !== null) counts.push(`${variadicFrom} or more`);
  if (!counts.length) return "no arguments";
  const last = counts.pop()!;
  const words = counts.length ? `${counts.join(", ")} or ${last}` : last;
  return `${words} argument${words === "1" ? "" : "s"}`;
}

/** `name()` with the cursor after it when it takes no arguments, else
 * between the parentheses. */
function call(name: string, takesNone: boolean): string {
  return takesNone ? `${escapeSnippet(name)}()` : `${escapeSnippet(name)}($0)`;
}

/** Inside a comment `(: … :)` or a string literal, at the end of `text`. */
export function inCommentOrString(text: string): boolean {
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = text[i + 1] === quote ? (i++, quote) : undefined;
    } else if (c === "(" && text[i + 1] === ":") (depth++, i++);
    else if (depth && c === ":" && text[i + 1] === ")") (depth--, i++);
    else if (!depth && (c === '"' || c === "'")) quote = c;
  }
  return depth > 0 || quote !== undefined;
}

const VAR = /\$([\w.-]+(?::[\w.-]*)?)?$/;
const WORD = /[A-Za-z_][\w.-]*(?::[\w.-]*)?$/;

/** The suggestions at `offset` of `modules[0]` (the open file; the rest
 * are the modules it imports). `explicit` is true when the user asked
 * for suggestions (Ctrl+Space) rather than typed. */
export function suggestQuery(modules: Loaded[], offset: number, builtins: readonly Builtin[], explicit = false): QuerySuggestion[] {
  const self = modules[0];
  if (!self) return [];
  const text = self.text;
  const before = text.slice(0, offset);
  if (inCommentOrString(before)) return [];

  // Variables: the module's locals in scope here, and every module's
  // globals. A name is offered once, the nearest binding first.
  const variables = (start: number): QuerySuggestion[] => {
    const seen = new Set<string>();
    const out: QuerySuggestion[] = [];
    const locals = self.module.declarations
      .filter((d) => (d.kind === "variable" || d.kind === "param") && d.scope && d.scope.start <= offset && offset <= d.scope.end && d.end < offset)
      .sort((a, b) => b.start - a.start);
    const globals = modules.flatMap((m, i) =>
      m.module.declarations.filter((d) => d.kind === "variable" && !d.scope && (i > 0 || d.end < offset)).map((d) => ({ d, own: i === 0 })),
    );
    for (const d of locals) {
      if (seen.has(d.label)) continue;
      seen.add(d.label);
      out.push({ label: d.label, kind: "variable", insert: escapeSnippet(d.label), detail: d.kind === "param" ? "parameter" : "variable", start, rank: 0 });
    }
    for (const { d, own } of globals) {
      if (seen.has(d.label)) continue;
      seen.add(d.label);
      out.push({ label: d.label, kind: "variable", insert: escapeSnippet(d.label), detail: own ? "global variable" : "imported variable", start, rank: 1 });
    }
    return out;
  };

  const v = VAR.exec(before);
  if (v) return variables(offset - v[0].length);

  const w = WORD.exec(before);
  const word = w?.[0] ?? "";
  if (!word && !explicit) return [];
  const start = offset - word.length;
  // A name after `<` is a direct element constructor; after `@` or `/`
  // without a function call it is a path step, but functions may follow
  // `/` too, so only `<` and `@` stop suggestions.
  if (/[<@]$/.test(text.slice(0, start))) return [];

  const declared: QuerySuggestion[] = modules.flatMap((m, i) =>
    m.module.declarations
      .filter((d) => d.kind === "function")
      .map((d) => {
        const name = m.text.slice(d.start, d.end);
        return {
          label: name,
          kind: "function" as const,
          insert: call(name, d.arity === 0),
          detail: arityText([d.arity ?? 0], null),
          documentation: i === 0 ? "Declared in this module." : `Declared in ${m.uri.slice(m.uri.lastIndexOf("/") + 1)}.`,
          start,
          rank: 1,
        };
      }),
  );
  const builtin = (f: Builtin, prefixed: boolean): QuerySuggestion => {
    const name = prefixed ? `${f.prefix}:${f.name}` : f.name;
    const takesNone = f.variadicFrom === null && f.arities.length === 1 && f.arities[0] === 0;
    const where = URDR_PREFIXES.has(f.prefix) ? "Urðr's own function: it does its work in the database." : `In ${f.namespace}.`;
    return { label: name, kind: "function", insert: call(name, takesNone), detail: arityText(f.arities, f.variadicFrom), documentation: `${f.prefix}:${f.name}. ${where}`, start, rank: 2 };
  };

  const colon = word.indexOf(":");
  if (colon >= 0) {
    const prefix = word.slice(0, colon);
    return [
      ...builtins.filter((f) => f.prefix === prefix).map((f) => builtin(f, true)),
      ...declared.filter((d) => d.label.startsWith(`${prefix}:`)),
    ];
  }
  const prefixes = new Map<string, string>([["local", "http://www.w3.org/2005/xquery-local-functions"]]);
  for (const f of builtins) if (!prefixes.has(f.prefix)) prefixes.set(f.prefix, f.namespace);
  for (const m of text.matchAll(/\b(?:declare|import\s+module)\s+namespace\s+([\w.-]+)\s*=\s*["']([^"']*)/g)) prefixes.set(m[1]!, m[2]!);
  const out: QuerySuggestion[] = [
    ...declared,
    ...builtins.filter((f) => f.prefix === "fn").map((f) => builtin(f, false)),
    ...KEYWORDS.map((k) => ({ label: k, kind: "keyword" as const, insert: k, start, rank: 3 })),
    ...[...prefixes].map(([p, uri]) => ({ label: `${p}:`, kind: "prefix" as const, insert: `${p}:`, detail: "prefix", documentation: uri, start, retrigger: true, rank: 4 })),
  ];
  // Asked for with nothing typed, the variables in scope come first: they
  // are what an expression most often goes on with.
  return word ? out : [...variables(start), ...out];
}
