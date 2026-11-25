// The language server's platform in VS Code for the Web. The server is
// a web worker: it asks the client for workspace files and kept texts,
// which VS Code reads wherever the workspace is (a GitHub repository, a
// local folder), and fetches the extension's own files itself.
import type { Connection } from "vscode-languageserver/node";
import { load } from "./core.ts";
import type { Platform, Store } from "./platform.ts";

async function fetchText(uri: string): Promise<string | undefined> {
  const response = await fetch(uri);
  return response.ok ? response.text() : undefined;
}

export function webPlatform(connection: Connection): Platform {
  /** The extension's folder, as a URI ending in `/`. */
  let base = "";
  let module: WebAssembly.Module | undefined;
  /** The transformation worker's script, as a blob URL: a worker may
   * only start a worker from its own origin. */
  let script = "";
  const own = (uri: string) => base.length > 1 && uri.startsWith(base);
  const store = (area: string): Store => ({
    get: async (key) => (await connection.sendRequest<string | null>("urdr/store/get", { area, key })) ?? undefined,
    set: async (key, text) => {
      await connection.sendRequest("urdr/store/set", { area, key, text });
    },
  });
  return {
    async init(options) {
      base = String(options["extensionUri"] ?? "");
      if (!base.endsWith("/")) base += "/";
      const [bytes, code] = await Promise.all([
        fetch(`${base}out/urdr_vscode_core_bg.wasm`).then((r) => r.arrayBuffer()),
        fetchText(`${base}out/web/transformer.js`),
      ]);
      module = await WebAssembly.compile(bytes);
      load(module);
      script = URL.createObjectURL(new Blob([code ?? ""], { type: "text/javascript" }));
    },
    readFile: async (uri) => (own(uri) ? fetchText(uri) : ((await connection.sendRequest<string | null>("urdr/readFile", uri)) ?? undefined)),
    own,
    store,
    spawn: (on) => {
      const w = new Worker(script);
      w.onmessage = (e: MessageEvent) => on.message(e.data);
      w.onerror = (e: ErrorEvent) => {
        e.preventDefault();
        on.error(new Error(e.message));
      };
      // The worker loads the module the server compiled.
      w.postMessage({ module });
      return {
        post: (m) => w.postMessage(m),
        terminate: () => w.terminate(),
      };
    },
    teiStylesheets: () => `${base}tei-stylesheets/`,
  };
}
