// Running XSLT transformations for the language server: in a worker
// thread, with a time limit, reading the modules and documents the
// stylesheet asks for.
import { Worker } from "node:worker_threads";
import { converse, type Reader } from "./converse.ts";
import type { CoreProblem, TransformAnswer, TransformRequest } from "./core.ts";

/** What the extension asks the server to run: URIs, not texts. */
export interface TransformParams {
  stylesheet: string;
  source?: string | null;
  parameters?: Record<string, string>;
  initialTemplate?: string | null;
  initialMode?: string | null;
  output?: string | null;
}

interface Pending {
  resolve: (answer: string) => void;
  reject: (e: Error) => void;
}

/** A worker that runs transformations one at a time. */
export class Transformer {
  private readonly file: string;
  private worker: Worker | undefined;
  private next = 0;
  private readonly pending = new Map<number, Pending>();

  /** `file` is the bundled worker, `transformer.js`. */
  constructor(file: string) {
    this.file = file;
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(this.file);
    w.on("message", (m: { id: number; answer?: string; error?: string }) => {
      if (m.answer === undefined) {
        // The module trapped and cannot be trusted any more.
        this.fail(new Error(`the transformation failed: ${m.error ?? "unknown error"}`));
        return;
      }
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      p?.resolve(m.answer);
    });
    w.on("error", (e) => this.fail(e));
    w.on("exit", () => {
      if (this.worker === w) this.fail(new Error("the transformation stopped unexpectedly"));
    });
    w.unref();
    this.worker = w;
    return w;
  }

  private fail(e: Error): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    this.stop();
    for (const p of all) p.reject(e);
  }

  /** Stops the worker; the next call starts a new one. */
  stop(): void {
    const w = this.worker;
    this.worker = undefined;
    void w?.terminate();
  }

  /** Runs one round, giving up after `timeout` milliseconds. */
  call(request: string, timeout: number): Promise<string> {
    const id = this.next++;
    const worker = this.start();
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`the transformation took longer than ${Math.round(timeout / 1000)} seconds and was stopped`));
      }, timeout);
      this.pending.set(id, {
        resolve: (a) => {
          clearTimeout(timer);
          resolve(a);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      worker.postMessage({ id, request });
    });
  }

  /** Runs a transformation, reading what it needs with `read`. The time
   * limit applies to the whole run. */
  async transform(params: TransformParams, read: Reader, timeout: number): Promise<TransformAnswer> {
    const problem = (message: string, uri?: string): TransformAnswer => ({
      results: [],
      messages: [],
      problems: [{ code: "", message, start: null, end: null, line: 0, column: 0, uri: uri ?? null } satisfies CoreProblem],
      needed: [],
    });
    const stylesheetText = await read(params.stylesheet).catch(() => undefined);
    if (stylesheetText === undefined) return problem(`The stylesheet ${params.stylesheet} cannot be read.`);
    let sourceText: string | undefined;
    if (params.source) {
      sourceText = await read(params.source).catch(() => undefined);
      if (sourceText === undefined) return problem(`The source document ${params.source} cannot be read.`);
    }
    const request: TransformRequest = {
      stylesheet: params.stylesheet,
      stylesheetText,
      source: params.source ?? null,
      sourceText: sourceText ?? null,
      parameters: params.parameters ?? {},
      initialTemplate: params.initialTemplate ?? null,
      initialMode: params.initialMode ?? null,
      output: params.output ?? null,
      now: Date.now(),
      timezone: -new Date().getTimezoneOffset(),
    };
    const until = Date.now() + timeout;
    try {
      return await converse(
        async (files) => JSON.parse(await this.call(JSON.stringify({ ...request, files }), Math.max(1, until - Date.now()))) as TransformAnswer,
        read,
      );
    } catch (e) {
      return problem(e instanceof Error ? e.message : String(e));
    }
  }
}
