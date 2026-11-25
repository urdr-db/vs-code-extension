// The language server's platform in desktop VS Code: Node, with the disk
// and worker threads.
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { load } from "./core.ts";
import type { Platform, Spawn, Store } from "./platform.ts";

/** Loads the WebAssembly module from `dir`. */
export function loadFrom(dir: string): void {
  load(readFileSync(join(dir, "urdr_vscode_core_bg.wasm")));
}

/** A store in a folder of the disk. */
export function dirStore(dir: () => string | undefined): Store {
  return {
    async get(key) {
      const d = dir();
      return d ? readFile(join(d, key), "utf8").catch(() => undefined) : undefined;
    },
    async set(key, text) {
      const d = dir();
      if (!d) return;
      await mkdir(d, { recursive: true });
      await writeFile(join(d, key), text, "utf8");
    },
  };
}

/** Starts the bundled worker `file` (transformer.js) in a thread. */
export function threads(file: string): Spawn {
  return (on) => {
    // Deep stylesheets need a deep stack, in V8 as in the module.
    const w = new Worker(file, { resourceLimits: { stackSizeMb: 256 } });
    w.on("message", on.message);
    w.on("error", on.error);
    w.on("exit", on.exit);
    w.unref();
    return { post: (m) => w.postMessage(m), terminate: () => void w.terminate() };
  };
}

/** The platform of the bundled server, which sits in out/ with the
 * module and the worker. */
export function nodePlatform(out: string): Platform {
  let cacheDir: string | undefined;
  const tei = pathToFileURL(join(out, "..", "tei-stylesheets")).href + "/";
  return {
    async init(options) {
      cacheDir = typeof options["cacheDir"] === "string" ? options["cacheDir"] : undefined;
      loadFrom(out);
    },
    readFile: async (uri) => (uri.startsWith("file:") ? readFile(fileURLToPath(uri), "utf8").catch(() => undefined) : undefined),
    own: () => false,
    store: (area) => dirStore(() => (cacheDir ? (area === "schemas" ? cacheDir : join(dirname(cacheDir), area)) : undefined)),
    spawn: threads(join(out, "transformer.js")),
    teiStylesheets: () => tei,
  };
}
