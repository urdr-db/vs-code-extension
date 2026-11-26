// The parts of the XSLT command and preview that need no editor: finding
// a document's stylesheet, filling in output paths, and the page the
// preview shows.
import type { CoreProblem, TransformAnswer } from "./core.ts";

/** The `href` of the document's `<?xml-stylesheet?>` for XSLT, if any.
 * CSS stylesheets are left out. */
export function stylesheetHref(text: string): string | undefined {
  const head = text.slice(0, 8000);
  for (const m of head.matchAll(/<\?xml-stylesheet\s([^?]*(?:\?(?!>)[^?]*)*)\?>/g)) {
    const pseudo = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`).exec(m[1]!)?.[2];
    const type = pseudo("type")?.toLowerCase();
    if (type && !/xsl|xml/.test(type)) continue;
    const href = pseudo("href");
    if (href && !/\.css$/i.test(href)) return href;
  }
  return undefined;
}

/** Replaces `${name}` in `template` with `vars[name]`; unknown names stay. */
export function expand(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (all, name: string) => vars[name] ?? all);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A problem's text with its place. */
export function describe(p: CoreProblem): string {
  const place = p.line ? ` (line ${p.line}${p.column ? `, column ${p.column}` : ""}${p.uri ? ` of ${p.uri}` : ""})` : p.uri ? ` (in ${p.uri})` : "";
  return `${p.code ? `${p.code}: ` : ""}${p.message}${place}`;
}

export interface PageOptions {
  /** The webview's `cspSource`. */
  cspSource: string;
  /** Where relative links and pictures resolve, as a webview URI ending in `/`. */
  base: string;
  /** Shown when the transformation failed and an older result is shown. */
  stale?: boolean;
  /** The text of the stylesheets the page links, where they could be
   * read: whether they colour the page decides its background. */
  linked?: string[];
}

/** VS Code puts its own styles first in every webview (the editor's font,
 * colours and padding, a transparent background). For an HTML result they
 * are undone, back to what a browser shows: the page's own stylesheets,
 * which come after, still win. */
const BROWSER_DEFAULTS =
  ":root{color-scheme:light;color:#000;scrollbar-color:revert}" +
  "body{overscroll-behavior-x:revert;background-color:revert;color:revert;font-family:revert;font-weight:revert;font-size:revert;margin:revert;padding:revert}" +
  "img,video{max-width:revert;max-height:revert}" +
  "a,a code,a:hover{color:revert}p>a{text-decoration:revert}" +
  "a:focus,input:focus,select:focus,textarea:focus{outline:revert;outline-offset:revert}" +
  "code{font-family:revert;color:revert;background-color:revert;padding:revert;border-radius:revert}pre code{padding:revert}" +
  "blockquote{background:revert;border-color:revert}" +
  "kbd{background-color:revert;color:revert;border:revert;border-radius:revert;box-shadow:revert;vertical-align:revert;padding:revert}" +
  "::-webkit-scrollbar{width:revert;height:revert}";

/** The page the preview shows:the principal result (as HTML when it is
 * HTML, else as text), with messages and problems in a bar on top.
 * Scripts never run: the page allows none. */
/** Whether the page gives its own background to the html or body
 * element, in its `<style>` elements, those elements' style attributes
 * or `css` (the stylesheets it links). A browser then paints the whole
 * window with it. */
export function paintsBackground(html: string, css: string[] = []): boolean {
  if (/<(?:html|body)\b[^>]*\bstyle\s*=\s*("[^"]*\bbackground[^"]*"|'[^']*\bbackground[^']*')/i.test(html)) return true;
  const sheets = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]!).concat(css);
  for (const sheet of sheets) {
    const text = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of text.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
      const root = rule[1]!.split(",").some((sel) => /^(?:html|body|:root)(?![\w-])[^\s>+~]*$/i.test(sel.trim()));
      if (!root) continue;
      for (const decl of rule[2]!.matchAll(/(?:^|;)\s*background(?:-color|-image)?\s*:([^;]*)/gi)) {
        if (!/^\s*(?:transparent|none|initial|unset|revert|inherit)?\s*(?:!important)?\s*$/i.test(decl[1]!)) return true;
      }
    }
  }
  return false;
}

export function previewPage(answer: TransformAnswer, options: PageOptions): string {
  const csp =
    `default-src 'none'; img-src ${options.cspSource} https: http: data:; media-src ${options.cspSource} https: http: data:; ` +
    `style-src ${options.cspSource} https: 'unsafe-inline'; font-src ${options.cspSource} https: data:;`;
  const head = `<meta http-equiv="Content-Security-Policy" content="${csp}"><base href="${escapeHtml(options.base)}">`;
  const notes: string[] = [];
  for (const p of answer.problems) notes.push(`<div class="urdr-error">${escapeHtml(describe(p))}</div>`);
  if (options.stale) notes.push(`<div class="urdr-note">Showing the last result that worked.</div>`);
  for (const m of answer.messages) notes.push(`<div class="urdr-message">${escapeHtml(m)}</div>`);
  const bar = notes.length
    ? `<div id="urdr-bar" style="all:initial;display:block;font:12px/1.4 var(--vscode-font-family,sans-serif);` +
      `background:var(--vscode-editorWidget-background,#eee);color:var(--vscode-foreground,#222);padding:6px 10px;` +
      `border-bottom:1px solid var(--vscode-editorWidget-border,#ccc);white-space:pre-wrap">${notes.join("")}</div>`
    : "";
  const result = answer.results[0];
  if (!result) {
    return `<!DOCTYPE html><html><head>${head}</head><body>${bar}</body></html>`;
  }
  if (result.method === "html" || result.method === "xhtml") {
    let html = result.text;
    // Our head goes first, so the policy holds before anything loads, and
    // the page is shown as a browser shows it, not in the editor's colours.
    // A browser paints a white window unless the page colours html or
    // body; a webview shows the editor through. A white html element
    // would hide a body's own background, so it is only given when the
    // page has none.
    const canvas = paintsBackground(html, options.linked) ? "" : ":root{background:#fff}";
    const page = head + `<style id="urdr-browser-defaults">${BROWSER_DEFAULTS}${canvas}</style>`;
    if (/<head(\s[^>]*)?>/i.test(html)) html = html.replace(/<head(\s[^>]*)?>/i, (m) => m + page);
    else if (/<html(\s[^>]*)?>/i.test(html)) html = html.replace(/<html(\s[^>]*)?>/i, (m) => `${m}<head>${page}</head>`);
    else html = `<head>${page}</head>${html}`;
    if (bar) {
      if (/<body(\s[^>]*)?>/i.test(html)) html = html.replace(/<body(\s[^>]*)?>/i, (m) => m + bar);
      else html = html.replace(/<\/head>/i, (m) => m + bar);
    }
    return html;
  }
  const style =
    "body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground)}" +
    "pre{margin:0;padding:10px;font:var(--vscode-editor-font-size,13px)/1.5 var(--vscode-editor-font-family,monospace);white-space:pre-wrap}";
  return `<!DOCTYPE html><html><head>${head}<style>${style}</style></head><body>${bar}<pre>${escapeHtml(result.text)}</pre></body></html>`;
}

/** The `href` of each stylesheet the page links, as written. */
export function stylesheetLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(m[0])) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[0]);
    if (href) out.push((href[1] ?? href[2] ?? href[3])!.replace(/&amp;/g, "&"));
  }
  return out;
}

/** The page with each stylesheet it links by an http address put in
 * place, as a webview (served over https) may not load one itself.
 * `fetchText` reads an address, or gives undefined. A stylesheet that
 * cannot be read is linked on https instead. Addresses inside the CSS
 * are made absolute, and http ones https. */
export async function inlineHttpStyles(html: string, fetchText: (url: string) => Promise<string | undefined>): Promise<string> {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].filter((m) => /\brel\s*=\s*["']?stylesheet\b/i.test(m[0]) && /\bhref\s*=\s*["']?http:\/\//i.test(m[0]));
  if (!links.length) return html;
  const texts = await Promise.all(
    links.map(async (m) => {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[0])!;
      const url = (href[1] ?? href[2] ?? href[3])!.replace(/&amp;/g, "&");
      const css = await fetchText(url).catch(() => undefined);
      if (css === undefined) return m[0].replace(/http:\/\//i, "https://");
      const media = /\bmedia\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0]);
      const absolute = css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (all, q: string, ref: string) => {
        if (/^(data|#)/i.test(ref)) return all;
        let to: string;
        try {
          to = new URL(ref, url).href;
        } catch {
          return all;
        }
        return `url(${q}${to.replace(/^http:/i, "https:")}${q})`;
      });
      const at = absolute.replace(/@import\s+(["'])http:/gi, "@import $1https:").replace(/<\/style/gi, "<\\/style");
      return `<style${media ? ` media="${media[1] ?? media[2]}"` : ""}>\n/* ${url} */\n${at}\n</style>`;
    }),
  );
  let out = "";
  let at = 0;
  links.forEach((m, k) => {
    out += html.slice(at, m.index) + texts[k];
    at = m.index! + m[0].length;
  });
  out += html.slice(at);
  // A <link></link> pair: drop the end tag left behind.
  return out.replace(/(<\/style>)\s*<\/link>/gi, "$1");
}
