// The Rust core, compiled to WebAssembly, and the checks it runs.
import { initSync, validateDocument, checkXquery, checkXpath, checkXslt, schemaOutline, transformXslt } from "../wasm/urdr_vscode_core.js";
import { converse, type Reader } from "./converse.ts";
import type { SchemaHint } from "./hints.ts";
import type { Outline } from "./suggest.ts";

let loaded = false;

/** Loads the module, once: its bytes, or the module compiled. */
export function load(module: BufferSource | WebAssembly.Module): void {
  if (loaded) return;
  initSync({ module });
  loaded = true;
}

function ready(): void {
  if (!loaded) throw new Error("The WebAssembly module is not loaded yet.");
}

/** A problem in a query or stylesheet. Offsets are UTF-8 bytes. */
export interface CoreProblem {
  code: string;
  message: string;
  start: number | null;
  end: number | null;
  line: number;
  column: number;
  uri: string | null;
}

export interface CoreAnswer {
  problems: CoreProblem[];
  needed: string[];
}

export type Kind = "xquery" | "xpath" | "xslt";

const checks: Record<Kind, (request: string) => string> = {
  xquery: checkXquery,
  xpath: checkXpath,
  xslt: checkXslt,
};

/** Checks a query or stylesheet, reading the modules it imports. */
export function check(kind: Kind, uri: string, text: string, read: Reader): Promise<CoreAnswer> {
  ready();
  return converse((files) => JSON.parse(checks[kind](JSON.stringify({ text, uri, files }))) as CoreAnswer, read);
}

/** A problem a validator found. */
export interface Issue {
  severity: string;
  message: string;
  path: string;
  language: string;
  constraint: string;
}

/** The validator's report, as Urðr's `Validate` request answers. */
export interface Report {
  status?: string;
  issues?: Issue[];
  note?: string;
  schemas?: string[];
  needed?: string[];
  error?: { code: string; message: string };
}

/** Checks an XML document against the schemas it names, reading them. */
export function validate(uri: string, text: string, read: Reader): Promise<Report> {
  ready();
  return converse(
    (files) => JSON.parse(validateDocument(JSON.stringify({ document: text, base: uri, files }))) as Report,
    read,
  );
}

export interface OutlineAnswer {
  outline: Outline | null;
  note: string;
  needed: string[];
}

/** The outline of the schemas `hints` name, with every schema text read
 * for it (for their documentation). */
export async function outline(hints: SchemaHint[], read: Reader): Promise<{ answer: OutlineAnswer; files: Record<string, string> }> {
  ready();
  const files: Record<string, string> = {};
  const request = (f: Record<string, string>) => JSON.stringify({ schemas: hints, files: f });
  const answer = await converse((f) => JSON.parse(schemaOutline(request(f))) as OutlineAnswer, read, files);
  return { answer, files };
}

/** A transformation to run, as the core takes it (without `files`). */
export interface TransformRequest {
  stylesheet: string;
  stylesheetText: string;
  source?: string | null;
  sourceText?: string | null;
  parameters?: Record<string, string>;
  initialTemplate?: string | null;
  initialMode?: string | null;
  /** Where the principal result goes. */
  output?: string | null;
  /** Milliseconds since 1970: WebAssembly has no clock. */
  now?: number;
  /** Offset from UTC in minutes. */
  timezone?: number;
}

/** One serialized result: the principal one has an empty `href`. */
export interface TransformResult {
  href: string;
  text: string;
  method: "xml" | "html" | "xhtml" | "text" | "json" | "adaptive";
  mediaType: string;
}

export interface TransformAnswer {
  results: TransformResult[];
  messages: string[];
  problems: CoreProblem[];
  needed: string[];
}

/** Runs one round of a transformation. Slow stylesheets block the
 * thread: the language server runs this in a worker (transformer.ts). */
export function transformOnce(request: string): string {
  ready();
  return transformXslt(request);
}
