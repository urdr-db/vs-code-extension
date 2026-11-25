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
}

/** The page the preview shows: the principal result (as HTML when it is
 * HTML, else as text), with messages and problems in a bar on top.
 * Scripts never run: the page allows none. */
export function previewPage(answer: TransformAnswer, options: PageOptions): string {
  const csp =
    `default-src 'none'; img-src ${options.cspSource} https: data:; media-src ${options.cspSource} https: data:; ` +
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
    // Our head goes first, so the policy holds before anything loads.
    if (/<head(\s[^>]*)?>/i.test(html)) html = html.replace(/<head(\s[^>]*)?>/i, (m) => m + head);
    else if (/<html(\s[^>]*)?>/i.test(html)) html = html.replace(/<html(\s[^>]*)?>/i, (m) => `${m}<head>${head}</head>`);
    else html = `<head>${head}</head>${html}`;
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
