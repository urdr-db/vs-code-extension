// The language server in VS Code for the Web, in a web worker.
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser";
import type { Connection } from "vscode-languageserver/node";
import { serve } from "./service.ts";
import { webPlatform } from "./web.ts";

const scope = self as unknown as Worker;
const connection = createConnection(new BrowserMessageReader(scope), new BrowserMessageWriter(scope)) as unknown as Connection;
serve(connection, webPlatform(connection));
