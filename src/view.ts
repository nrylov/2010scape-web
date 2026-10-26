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
export function layout(title: string, content: string, active = "Home") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="2010scape — a RuneScape revision 623 community project."><title>${escape(title)} - 2010scape</title><link rel="stylesheet" href="/style.css"></head><body><div class="site"><header><a class="brand" href="/" aria-label="2010scape home"><span class="crest">⚔</span><span>2010<span class="brand-gold">scape</span><small>A world worth returning to</small></span></a><a class="top-play" href="/play">Play now</a></header><nav aria-label="Main navigation">${[
    ["Home", "/"],
    ["News", "/news"],
    ["Play", "/play"],
    ["Status", "/status"],
  ]
    .map(
      ([name, href]) =>
        `<a href="${href}" ${active === name ? 'aria-current="page"' : ""}>${name}</a>`,
    )
    .join(
      "",
    )}</nav><div class="columns"><aside><section class="panel"><h2>The adventure</h2><a class="play-button" href="/play">Enter the world <span>Play 2010scape</span></a><p>Return to the age of adventure.</p></section><section class="panel side-links"><h2>Explore 2010scape</h2><a href="/news">Latest news <span>›</span></a><a href="/play">Getting started <span>›</span></a><a href="/status">Server status <span>›</span></a></section><section class="panel"><h2>October 2010</h2><p>Revision 623. Familiar places, skills to master, and adventures to discover.</p></section></aside><main id="main">${content}</main></div><footer><a href="/">Home</a> · <a href="/news">News</a> · <a href="/admin">Administration</a><p>2010scape is an independent community project and is not affiliated with Jagex. RuneScape is a trademark of Jagex Ltd.</p></footer></div></body></html>`;
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
