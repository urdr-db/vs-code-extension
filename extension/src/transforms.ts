// Running XSLT transformations for the language server: in a worker
// thread, with a time limit, reading the modules and documents the
// stylesheet asks for.
import { converse, type Reader } from "./converse.ts";
import { prefetchModules } from "./prefetch.ts";
import type { CoreProblem, TransformAnswer, TransformRequest } from "./core.ts";
import type { Spawn, WorkerHandle, WorkerReply } from "./platform.ts";

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
  private readonly spawn: Spawn;
  private worker: WorkerHandle | undefined;
  private next = 0;
  private readonly pending = new Map<number, Pending>();
  /** Transformations run one after another, each with its own time. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(spawn: Spawn) {
    this.spawn = spawn;
  }

  private start(): WorkerHandle {
    if (this.worker) return this.worker;
    const w: WorkerHandle = this.spawn({
      message: (m) => this.received(m),
      error: (e) => this.fail(e),
      exit: () => {
        if (this.worker === w) this.fail(new Error("the transformation stopped unexpectedly"));
      },
    });
    this.worker = w;
    return w;
  }

  private received(m: WorkerReply): void {
    if (m.answer === undefined) {
      // The module trapped and cannot be trusted any more.
      const error = m.error ?? "unknown error";
      this.fail(
        new Error(
          /out of bounds|call stack/i.test(error)
            ? "the stylesheet nests its calls too deeply and ran out of stack"
            : `the transformation failed: ${error}`,
        ),
      );
      return;
    }
    const p = this.pending.get(m.id);
    this.pending.delete(m.id);
    p?.resolve(m.answer);
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
    w?.terminate();
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
      worker.post({ id, request });
    });
  }

  /** Runs a transformation, reading what it needs with `read`, once the
   * ones before it are done. The time limit applies to the whole run. */
  transform(params: TransformParams, read: Reader, timeout: number): Promise<TransformAnswer> {
    const run = this.queue.then(() => this.transformNow(params, read, timeout));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async transformNow(params: TransformParams, read: Reader, timeout: number): Promise<TransformAnswer> {
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
      const known = await prefetchModules("xslt", params.stylesheet, stylesheetText, read);
      const answer = await converse(
        async (files) => JSON.parse(await this.call(JSON.stringify({ ...request, files }), Math.max(1, until - Date.now()))) as TransformAnswer,
        read,
        known,
      );
      // Out of rounds with files still wanted: say so, rather than show an
      // empty result.
      if (!answer.results.length && !answer.problems.length && answer.needed.length) {
        return problem(`The transformation stopped while it still needed ${answer.needed.join(", ")}.`, answer.needed[0]);
      }
      return answer;
    } catch (e) {
      return problem(e instanceof Error ? e.message : String(e));
    }
  }
}
