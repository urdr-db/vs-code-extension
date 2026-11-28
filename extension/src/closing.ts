// Closing tags as they are typed, as Urðr Studio's editor and VS Code's
// HTML editor do: `>` at the end of a start tag adds its end tag after
// the cursor, and `</` adds the name of the element still open there.
// The client (close-tags.ts) runs it, with no round trip to the server.
import { contextAt } from "./context.ts";

/** The text to put in at `offset` of `text` just after `typed` ("`>`" or
 * "`/`") was typed there, and where the cursor stays (an offset into the
 * text put in); undefined when nothing is to be added. `offset` is after
 * the typed character. */
export function closingFor(text: string, offset: number, typed: string): { insert: string; caret: number } | undefined {
  if (typed === ">") {
    const before = text.slice(0, offset - 1);
    // The tag the `>` ends: from its `<`, minding quotes.
    const lt = before.lastIndexOf("<");
    if (lt < 0) return undefined;
    const tag = before.slice(lt);
    const m = /^<([A-Za-z_\u00C0-\uFFFF][-.\w:\u00B7\u00C0-\uFFFF]*)(\s[^]*)?$/.exec(tag);
    if (!m) return undefined; // `</x>`, `<!-- >`, `<?pi >`, `<>`, ...
    // The tag must still be open: no `>` outside quotes since its `<`, and
    // no quote left open (a `>` inside an attribute value).
    const unquoted = (m[2] ?? "").replace(/"[^"]*"|'[^']*'/g, "");
    if (/[>"']/.test(unquoted)) return undefined;
    const rest = m[2] ?? "";
    if (rest.trimEnd().endsWith("/")) return undefined;
    // Not inside a comment, CDATA or processing instruction.
    if (contextAt(text, lt).place.kind !== "text") return undefined;
    if (inside(before, lt)) return undefined;
    const name = m[1]!;
    const end = `</${name}>`;
    // Already closed right after the cursor, as when retyping a `>`.
    if (text.startsWith(end, offset)) return undefined;
    return { insert: end, caret: 0 };
  }
  if (typed === "/") {
    if (text[offset - 2] !== "<") return undefined;
    if (inside(text.slice(0, offset - 2), offset - 2)) return undefined;
    const { open, place } = contextAt(text, offset - 2);
    if (place.kind !== "text") return undefined;
    const parent = open.at(-1);
    if (!parent) return undefined;
    // Already followed by the name, as when retyping the `/`.
    const after = text.slice(offset);
    if (after.startsWith(`${parent.qname}>`)) return undefined;
    const insert = `${parent.qname}>`;
    return { insert, caret: insert.length };
  }
  return undefined;
}

/** Whether `at` in `before` (which ends at `at`) is inside a comment,
 * CDATA section or processing instruction left open. */
function inside(before: string, at: number): boolean {
  const opened = (start: string, end: string) => {
    const s = before.lastIndexOf(start, at);
    return s >= 0 && before.indexOf(end, s + start.length) < 0;
  };
  return opened("<!--", "-->") || opened("<![CDATA[", "]]>") || opened("<?", "?>");
}
