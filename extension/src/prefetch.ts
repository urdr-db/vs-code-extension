// The modules a stylesheet includes or imports, or a query imports, read
// before the core is asked, so that the conversation (converse.ts) needs
// one round rather than one round per level of includes. The core stops
// at the first module it lacks, so TEI's HTML stylesheet, which includes
// some thirty modules, took thirty rounds, each compiling everything
// again, and ran out of rounds before it had them all.
import { load } from "./code-nav.ts";
import type { Reader } from "./converse.ts";
import { xqueryModule } from "./xquery-symbols.ts";
import { xslModule } from "./xsl-symbols.ts";

/** The texts of the modules `text` (at `uri`) includes or imports, and
 * theirs, by URI; not `uri` itself. */
export async function prefetchModules(kind: "xslt" | "xquery", uri: string, text: string, read: Reader): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const modules = await load(uri, text, read, kind === "xslt" ? xslModule : xqueryModule).catch(() => []);
  for (const m of modules) if (m.uri !== uri) files[m.uri] = m.text;
  return files;
}
