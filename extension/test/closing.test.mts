// Closing tags as they are typed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closingFor } from "../src/closing.ts";

/** What typing the character before `|` adds, as the text would read. */
function typed(marked: string): string | undefined {
  const i = marked.indexOf("|");
  const text = marked.slice(0, i) + marked.slice(i + 1);
  const c = closingFor(text, i, text[i - 1]!);
  return c && text.slice(0, i) + c.insert.slice(0, c.caret) + "|" + c.insert.slice(c.caret) + text.slice(i);
}

test("> after a start tag adds its end tag after the cursor", () => {
  assert.equal(typed(`<TEI><p>|`), `<TEI><p>|</p>`);
  assert.equal(typed(`<r><tei:hi rend="a > b">|`), `<r><tei:hi rend="a > b">|</tei:hi>`);
});

test("> adds nothing where no element starts", () => {
  assert.equal(typed(`<r><br/>|`), undefined);
  assert.equal(typed(`<r></p>|`), undefined);
  assert.equal(typed(`<r><!-- <p>|`), undefined);
  assert.equal(typed(`<?xml version="1.0"?>|`), undefined);
  assert.equal(typed(`<r><![CDATA[ <p>|`), undefined);
  assert.equal(typed(`<r a="x>|`), undefined);
  assert.equal(typed(`<p>a >|`), undefined);
  assert.equal(typed(`<p class="x">a >|`), undefined);
  // Already closed: typing the > again.
  assert.equal(typed(`<r><p>|</p>`), undefined);
});

test("</ adds the name of the element still open", () => {
  assert.equal(typed(`<TEI><p>text</|`), `<TEI><p>text</p>|`);
  assert.equal(typed(`<r><a/></|`), `<r><a/></r>|`);
  assert.equal(typed(`</|`), undefined);
  assert.equal(typed(`<r><!-- </|`), undefined);
  assert.equal(typed(`<r><x/|`), undefined);
});
