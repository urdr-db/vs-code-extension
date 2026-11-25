// The extension in VS Code for the Web: starts the language server in a
// web worker, and reads workspace files and kept texts for it, since a
// worker sees neither.
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { clientOptions } from "./client-common.ts";
import { register } from "./commands.ts";

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  register(context, () => client);
  const main = vscode.Uri.joinPath(context.extensionUri, "out", "web", "server.js");
  const options = clientOptions({ extensionUri: `${context.extensionUri.toString(true)}/` });
  client = new LanguageClient("urdr", "Urðr-XML", options, new Worker(main.toString(true)));

  const decoder = new TextDecoder();
  const read = async (uri: vscode.Uri) => {
    try {
      return decoder.decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return null;
    }
  };
  const kept = (area: string, key: string) => vscode.Uri.joinPath(context.globalStorageUri, area, key);
  client.onRequest("urdr/readFile", (uri: string) => read(vscode.Uri.parse(uri)));
  client.onRequest("urdr/store/get", (p: { area: string; key: string }) => read(kept(p.area, p.key)));
  client.onRequest("urdr/store/set", async (p: { area: string; key: string; text: string }) => {
    await vscode.workspace.fs.writeFile(kept(p.area, p.key), new TextEncoder().encode(p.text));
  });
  await client.start();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
