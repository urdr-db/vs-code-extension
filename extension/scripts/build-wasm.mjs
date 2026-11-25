// Builds the Rust core (crate urdr-vscode-core) into wasm/, where the
// language server loads it. Needs Rust with the wasm32-unknown-unknown
// target and wasm-bindgen-cli of the version the workspace pins.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const shell = process.platform === "win32";
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "-p", "urdr-vscode-core"]);
run("wasm-bindgen", [
  "--target", "web",
  "--out-dir", join(here, "..", "wasm"),
  join(root, "target", "wasm32-unknown-unknown", "release", "urdr_vscode_core.wasm"),
]);
