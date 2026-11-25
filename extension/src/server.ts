// The language server in desktop VS Code, in its own Node process.
import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import { nodePlatform } from "./node.ts";
import { serve } from "./service.ts";

serve(createConnection(ProposedFeatures.all), nodePlatform(__dirname));
