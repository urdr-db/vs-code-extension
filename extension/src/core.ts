// The Rust core, compiled to WebAssembly, and the checks it runs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initSync, validateDocument, checkXquery, checkXpath, checkXslt } from "../wasm/urdr_vscode_core.js";
import { converse, type Reader } from "./converse.ts";

let loaded = false;

/** Loads the module, once. It sits next to the bundled server. */
export function load(dir?: string): void {
  if (loaded) return;
  initSync({ module: readFileSync(join(dir ?? __dirname, "urdr_vscode_core_bg.wasm")) });
  loaded = true;
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
  load();
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
  load();
  return converse(
    (files) => JSON.parse(validateDocument(JSON.stringify({ document: text, base: uri, files }))) as Report,
    read,
  );
}
