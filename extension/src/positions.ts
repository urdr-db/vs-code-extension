// Offsets in a document's text. The Rust core counts UTF-8 bytes; VS
// Code counts UTF-16 code units, by line and character.

export interface Position {
  line: number;
  character: number;
}

/** The UTF-16 index in `text` of UTF-8 byte offset `byte`. */
export function byteToIndex(text: string, byte: number): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    if (bytes >= byte) return i;
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return text.length;
}

/** The line and character of UTF-16 index `index`. */
export function indexToPosition(text: string, index: number): Position {
  let line = 0;
  let start = 0;
  for (let i = text.indexOf("\n"); i >= 0 && i < index; i = text.indexOf("\n", i + 1)) {
    line++;
    start = i + 1;
  }
  return { line, character: index - start };
}

/** The UTF-16 index of a 1-based line and column, column counting code
 * points as the Rust core does. */
export function lineColumnToIndex(text: string, line: number, column: number): number {
  let index = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf("\n", index);
    if (next < 0) return text.length;
    index = next + 1;
  }
  for (let c = 1; c < column && index < text.length && text[index] !== "\n"; c++) {
    const code = text.charCodeAt(index);
    index += code >= 0xd800 && code <= 0xdbff ? 2 : 1;
  }
  return index;
}

/** The end of the word (name, number or token) starting at `index`, so a
 * problem marks something visible. */
export function wordEnd(text: string, index: number): number {
  // On a tag, mark the tag's name with its angle bracket.
  const m = /^(?:<\/?)?[\p{L}\p{N}_:.\-$@]+/u.exec(text.slice(index, index + 200));
  return index + Math.max(1, m?.[0].length ?? 1);
}
