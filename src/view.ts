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
  const entries = rows.map(row => `<div class="sectionBody"><div class="recentNews"><div class="newsTitle"><h3><a href="/news/${escape(row.id)}">${escape(row.title)}</a></h3><span>${date(row.published_at!)}</span></div><p>${escape(row.body.slice(0, 300))}${row.body.length > 300 ? "…" : ""} <a href="/news/${escape(row.id)}">Read more...</a></p></div></div>`).join("") || '<div class="sectionBody"><div class="recentNews"><div class="newsTitle"><h3>2010scape news</h3></div><p>No announcements have been published yet.</p></div></div>';
  return entries + '<div class="sectionBody"><a href="/news">All 2010scape news</a></div>';
}
export function newsList(rows: Announcement[], limit?: number) {
  return (
    rows
      .slice(0, limit)
      .map(
        (row) =>
          `<article class="news-item"><time datetime="${new Date(Number(row.published_at)).toISOString()}">${date(row.published_at!)}</time><h3><a href="/news/${escape(row.id)}">${escape(row.title)}</a></h3><p>${escape(row.body.slice(0, 220))}${row.body.length > 220 ? "…" : ""}</p><a class="read-more" href="/news/${escape(row.id)}">Read more ›</a></article>`,
      )
      .join("") ||
    '<div class="empty"><h3>A new chapter is beginning</h3><p>There are no published announcements yet. Check back here for development news and community updates.</p></div>'
  );
}
export const field = (csrf: string) =>
  `<input type="hidden" name="csrf" value="${escape(csrf)}">`;
export function editor(csrf: string, row?: Announcement, error = "") {
  return `<section class="panel"><h1>${row ? "Edit announcement" : "Create announcement"}</h1>${error ? `<p role="alert" class="error">${escape(error)}</p>` : ""}<form method="post" action="/admin/announcements${row ? "/" + escape(row.id) : ""}">${field(csrf)}<label>Title<input name="title" maxlength="160" required value="${escape(row?.title)}"></label><label>Announcement<textarea name="body" rows="14" maxlength="30000" required>${escape(row?.body)}</textarea></label><p class="hint">Plain text only. New paragraphs are preserved; HTML is displayed as text.</p><label>Publication<select name="state"><option value="draft" ${row?.state !== "published" ? "selected" : ""}>Draft — private</option><option value="published" ${row?.state === "published" ? "selected" : ""}>Published — public</option></select></label><button type="submit">Save announcement</button> <a href="/admin">Cancel</a></form></section>`;
}
