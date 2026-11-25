// The extension in desktop VS Code: starts the language server in a
// Node process and passes it the settings.
import * as vscode from "vscode";
import { clientOptions } from "./client-common.ts";
import { register } from "./commands.ts";
import { LanguageClient, TransportKind, type ServerOptions } from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  register(context, () => client);
  const module = context.asAbsolutePath("out/server.js");
  const server: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: { module, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6019"] } },
  };
  const options = clientOptions({ cacheDir: vscode.Uri.joinPath(context.globalStorageUri, "schemas").fsPath });
  client = new LanguageClient("urdr", "Urðr-XML", server, options);
  await client.start();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
