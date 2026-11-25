// Bundles the client, the language server and its transformation
// worker into out/ for desktop VS Code and into out/web/ for VS Code for
// the Web, and copies the WebAssembly module, which both load, to out/.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("out", { recursive: true });
// The wasm-bindgen glue reads import.meta.url only to find the module
// itself, which the server loads by path instead (initSync).
const common = { logOverride: { "empty-import-meta": "silent" }, bundle: true, platform: "node", format: "cjs", target: "node20", sourcemap: true, minify: true };
await build({ ...common, entryPoints: ["src/client.ts"], outfile: "out/client.js", external: ["vscode"] });
await build({ ...common, entryPoints: ["src/server.ts"], outfile: "out/server.js" });
await build({ ...common, entryPoints: ["src/transformer.ts"], outfile: "out/transformer.js" });
copyFileSync("wasm/urdr_vscode_core_bg.wasm", "out/urdr_vscode_core_bg.wasm");

// The web builds run in web workers. The language server's shared code
// imports the Node half of vscode-languageserver; the browser half has
// the same API.
const web = { ...common, platform: "browser", target: "es2022", alias: { "vscode-languageserver/node": "vscode-languageserver/browser" } };
await build({ ...web, format: "cjs", entryPoints: ["src/client-web.ts"], outfile: "out/web/client.js", external: ["vscode"] });
await build({ ...web, format: "iife", entryPoints: ["src/server-web.ts"], outfile: "out/web/server.js" });
await build({ ...web, format: "iife", entryPoints: ["src/transformer-web.ts"], outfile: "out/web/transformer.js" });

// The icon, the README and the changelog live at the repository root;
// the package is made from this folder, so they are copied in.
mkdirSync("media", { recursive: true });
copyFileSync("../icon.png", "media/icon.png");
// Links in them point at the repository, so they work on the
// Marketplace as in VS Code: pictures at their raw files, the rest at
// their pages on GitHub.
const REPO = "https://github.com/urdr-db/vs-code-extension";
const absolute = (md) =>
  md.replace(/(!?)\[([^\]]*)\]\((?![a-z][\w+.-]*:|#)([^)\s]+)\)/gi, (_, image, text, path) =>
    image
      ? `![${text}](${REPO.replace("github.com", "raw.githubusercontent.com")}/main/${path})`
      : `[${text}](${REPO}/blob/main/${path})`,
  );
writeFileSync("README.md", absolute(readFileSync("../README.md", "utf8")));
writeFileSync("CHANGELOG.md", absolute(readFileSync("../CHANGELOG.md", "utf8")));
