// Bundles the client and the language server into out/, and copies the
// WebAssembly module next to the server.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("out", { recursive: true });
// The wasm-bindgen glue reads import.meta.url only to find the module
// itself, which the server loads by path instead (initSync).
const common = { logOverride: { "empty-import-meta": "silent" }, bundle: true, platform: "node", format: "cjs", target: "node20", sourcemap: true, minify: true };
await build({ ...common, entryPoints: ["src/client.ts"], outfile: "out/client.js", external: ["vscode"] });
await build({ ...common, entryPoints: ["src/server.ts"], outfile: "out/server.js" });
copyFileSync("wasm/urdr_vscode_core_bg.wasm", "out/urdr_vscode_core_bg.wasm");
