import {contentExcerpt} from "./richtext";
import type { Announcement } from "./store";
export const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const date = (stamp: number) =>
  new Date(Number(stamp)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
/** Minimal operator fallback when the separately supplied archive is unavailable. */
export function layout(title: string, content: string, _active = "Home") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} - 2010scape</title><link rel="stylesheet" href="/site-overrides.css"></head><body class="site-app-page archive-unavailable"><nav><a href="/">Home</a> · <a href="/news">News</a> · <a href="/play">Play</a> · <a href="/status">Status</a> · <a href="/admin">Administration</a></nav><main class="site-app-content">${content}</main></body></html>`;
}
/** Dynamic news bodies inserted inside the original homepage's news section. */
export function archiveNews(rows: Announcement[]) {
  const entries = rows.map(row => `<div class="sectionBody"><div class="recentNews"><div class="newsTitle"><h3><a href="/${row.kind==='devblog'?'devblog':'news'}/${escape(row.id)}">${escape(row.title)}</a></h3><span>${date(row.published_at!)}</span></div><p>${escape(row.summary || contentExcerpt(row.body, 300))} <a href="/${row.kind==='devblog'?'devblog':'news'}/${escape(row.id)}">Read more...</a></p></div></div>`).join("") || '<div class="sectionBody"><div class="recentNews"><div class="newsTitle"><h3>2010scape news</h3></div><p>No announcements have been published yet.</p></div></div>';
  return entries + '<div class="sectionBody"><a href="/news">All 2010scape news</a></div>';
}
export function newsList(rows: Announcement[], limit?: number) {
  return (
    rows
      .slice(0, limit)
      .map(
        (row) =>
          `<article class="news-item"><time datetime="${new Date(Number(row.published_at)).toISOString()}">${date(row.published_at!)}</time><h3><a href="/${row.kind==='devblog'?'devblog':'news'}/${escape(row.id)}">${escape(row.title)}</a></h3><p>${escape(row.summary || contentExcerpt(row.body, 220))}</p><a class="read-more" href="/${row.kind==='devblog'?'devblog':'news'}/${escape(row.id)}">Read more ›</a></article>`,
      )
      .join("") ||
    '<div class="empty"><h3>A new chapter is beginning</h3><p>There are no published announcements yet. Check back here for development news and community updates.</p></div>'
  );
}
export const field = (csrf: string) =>
  `<input type="hidden" name="csrf" value="${escape(csrf)}">`;
export function editor(csrf: string, row?: Announcement, error = "", submitted?: Partial<Announcement>) {
  const editing = !!row;
  if (submitted) row = {...row, ...submitted} as Announcement;
  const option = (value:string, current:string|undefined, label=value) => `<option value="${escape(value)}"${value===current?' selected':''}>${escape(label)}</option>`;
  return `<section class="panel"><h1>${editing ? "Edit post" : "Create post"}</h1>${error ? `<p role="alert" class="error">${escape(error)}</p>` : ""}<form class="editorial-editor" method="post" action="/admin/announcements${editing ? "/" + escape(row?.id) : ""}">${field(csrf)}
<label>Post type<select name="kind">${option('news',row?.kind??'news','News announcement')}${option('devblog',row?.kind,'Developer blog')}</select></label>
<label>Title<input name="title" maxlength="160" required value="${escape(row?.title)}"></label>
<label>Author<input name="author" maxlength="80" value="${escape(row?.author??'2010scape team')}"></label>
<label>Category (news)<select name="category">${['Game Updates','Website Updates','Customer Support','Technical','Community','Behind the Scenes'].map(value=>option(value,row?.category??'Game Updates')).join('')}</select></label>
<label>Project (developer blog)<input name="project" maxlength="100" value="${escape(row?.project??'Development')}"></label>
<label>Tags (developer blog, separated by commas)<input name="tags" maxlength="300" value="${escape(row?.tags)}"></label>
<label>List summary (optional)<textarea name="summary" rows="2" maxlength="500">${escape(row?.summary)}</textarea></label>
<label>Formatting<select name="format">${option('markdown',row?.format??'markdown','Rich formatting (Markdown)')}${option('plain',row?.format,'Plain text')}</select></label>
<div class="editor-toolbar" role="toolbar" aria-label="Formatting"><button type="button" data-format="bold">Bold</button><button type="button" data-format="italic">Italic</button><button type="button" data-format="heading">Heading</button><button type="button" data-format="link">Link</button><button type="button" data-format="image">Picture</button><button type="button" data-format="list">List</button><button type="button" data-preview>Preview</button></div>
<label>Body<textarea id="post-body" name="body" rows="16" maxlength="30000" required>${escape(row?.body)}</textarea></label>
<p class="hint">Use **bold**, *italic*, ## headings, [links](https://example.com), and ![picture description](https://example.com/image.png). Pictures can also use local /archive/ URLs. HTML is displayed as text.</p>
<div class="editor-preview editorial-body" aria-live="polite" hidden></div>
<label>Publication<select name="state">${option('draft',row?.state??'draft','Draft — private')}${option('published',row?.state,'Published — public')}</select></label><button type="submit">Save post</button> <a href="/admin">Cancel</a></form><script src="/editor.js" defer></script></section>`;
}
