// The worker thread that runs XSLT transformations in desktop VS Code,
// so that a slow stylesheet neither holds up the checks nor runs
// forever: the language server stops the worker when a transformation
// takes too long.
import { parentPort } from "node:worker_threads";
import { transformOnce } from "./core.ts";
import { loadFrom } from "./node.ts";

loadFrom(__dirname);
parentPort?.on("message", (m: { id: number; request: string }) => {
  try {
    parentPort?.postMessage({ id: m.id, answer: transformOnce(m.request) });
  } catch (e) {
    // A trap in the module (such as a stack overflow) leaves it unusable:
    // the server starts a new worker.
    parentPort?.postMessage({ id: m.id, error: e instanceof Error ? e.message : String(e) });
  }
});
