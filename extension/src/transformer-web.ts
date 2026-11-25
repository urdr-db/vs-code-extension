// The worker that runs XSLT transformations in VS Code for the Web. The
// language server sends it the compiled module first, then requests;
// it stops the worker when a transformation takes too long.
import { load, transformOnce } from "./core.ts";

const scope = self as unknown as {
  onmessage: (e: MessageEvent) => void;
  postMessage(message: unknown): void;
};

scope.onmessage = (e) => {
  const m = e.data as { module?: WebAssembly.Module; id: number; request: string };
  if (m.module) {
    load(m.module);
    return;
  }
  try {
    scope.postMessage({ id: m.id, answer: transformOnce(m.request) });
  } catch (err) {
    // A trap in the module (such as running out of stack) leaves it
    // unusable: the server starts a new worker.
    scope.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
