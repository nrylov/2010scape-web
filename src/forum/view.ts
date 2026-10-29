import { renderRichText } from "../richtext";
import type { ArchiveSite } from "../archive";
import { moderator, type ForumActor, type ForumBoard, type ForumCategory, type ForumPost, type ForumThread } from "./store";

export const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const when = (time: number | null | undefined) => time ? new Date(Number(time)).toLocaleString("en-GB",{timeZone:"UTC",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) + " UTC" : "—";
const asset = (path: string) => "/assets/site/img/forum/" + path;
const csrf = (actor: ForumActor) => `<input type="hidden" name="csrf" value="${escape(actor.csrf)}">`;
export const form = (actor: ForumActor, action: string, content: string, className = "forum-action") => `<form class="${className}" method="post" action="${escape(action)}">${csrf(actor)}${content}</form>`;
const button = (text: string, value = "") => `<button class="buttonsmall" type="submit"${value ? ` name="action" value="${escape(value)}"` : ""}>${escape(text)}</button>`;
export function pages(path: string, page: number, total: number, size: number) {
  const count = Math.max(1, Math.ceil(total / size)), separator = path.includes("?") ? "&" : "?";
  const link = (n: number, text: string) => `<a href="${escape(path+separator+"page="+n)}">${text}</a>`;
  return `<ul class="flat forum-pages"><li>${page>1?link(1,"&lt;&lt; first"):"&lt;&lt; first"}</li><li>${page>1?link(page-1,"&lt; prev"):"&lt; prev"}</li><li>Page ${page} of ${count}</li><li>${page<count?link(page+1,"next &gt;"):"next &gt;"}</li><li>${page<count?link(count,"last &gt;&gt;"):"last &gt;&gt;"}</li></ul>`;
}
export function boardIndex(categories: ForumCategory[], boards: ForumBoard[]) {
  return categories.map(category=>`<div class="brown_box_forum brown_box_stack"><table class="group"><tr><td class="groupname" colspan="2"><div class="groupname">${escape(category.title)}</div></td><td class="threads title n">Threads</td><td class="posts title n">Posts</td><td class="lastpost title">Last Post</td></tr>${boards.filter(board=>board.category_id===category.id).map(board=>`<tr class="s"><td></td></tr><tr class="f"><td class="i"><a href="/forums/boards/${escape(board.id)}"><img src="${asset("icons/"+board.icon)}" alt=""></a></td><td class="h"><span class="t"><a href="/forums/boards/${escape(board.id)}">${escape(board.title)}</a></span>${board.locked?" <span class=\"forum-label\">Locked</span>":""}<br>${escape(board.description)}</td><td class="n">${board.thread_count??0}</td><td class="n">${board.post_count??0}</td><td class="r u">${when(board.last_post)}</td></tr>`).join("")}</table></div>`).join("");
}
export function threadList(rows: ForumThread[]) {
  return `<table><tr><td class="title1 first-child">Thread</td><td class="center title">Posts</td><td class="title1">Last Post</td></tr>${rows.map(thread=>`<tr class="${thread.pinned?"thdstky":"thdnrml"}${thread.hidden?" forum-hidden":""}"><td class="threadtitle">${thread.pinned?"<span class=\"forum-label\">Pinned</span> ":""}${thread.locked?"<span class=\"forum-label\">Locked</span> ":""}${thread.hidden?"<span class=\"forum-label\">Hidden</span> ":""}<a class="sticky2" href="/forums/threads/${escape(thread.id)}">${escape(thread.title)}</a><br><span class="nt">created by <span class="username">${escape(thread.author_name)}</span></span></td><td class="n posts">${Number(thread.post_count??0)}</td><td class="updated">${when(thread.updated_at)}</td></tr>`).join("") || '<tr class="thdnrml"><td colspan="3">No threads have been posted here yet.</td></tr>'}</table>`;
}
export function posts(rows: ForumPost[], thread: ForumThread, actor?: ForumActor) {
  return rows.map(post=>`<a class="msgplace" id="post-${escape(post.id)}"></a><table class="message${post.hidden?" forum-hidden":""}" cellspacing="0"><tr><td class="leftpanel Member"><div class="msgcreator uname">${escape(post.author_name)}</div><div class="modtype">${post.author_role==="admin"?"Administrator":post.author_role==="moderator"?"Forum moderator":"Community member"}</div><div class="msgcommands">${actor && ((actor.id===post.author_id && !thread.locked && !post.hidden)||moderator(actor))?`<a href="/forums/posts/${escape(post.id)}/edit">Edit</a>`:""}${actor&&moderator(actor)?form(actor,`/forums/posts/${post.id}/moderate`,button(post.hidden?"Show post":"Hide post",post.hidden?"unhide":"hide")):""}</div></td><td class="rightpanel"><div class="msgtime">${when(post.created_at)}${Number(post.updated_at)>Number(post.created_at)?`<br>Last edited ${when(post.updated_at)}`:""}${post.hidden?" <b>Hidden from public view</b>":""}</div><div class="msgcontents forum-richtext">${renderRichText(post.body)}</div></td></tr></table>`).join("");
}
export function compose(actor: ForumActor, action: string, options: {title?:string;body?:string;thread?:boolean;submit?:string} = {}) {
  return form(actor,action,`<div class="forum-compose">${options.thread?`<p><label>Thread title<br><input class="textinput" name="title" maxlength="120" required value="${escape(options.title??"")}"></label></p>`:""}<div class="editor-toolbar" role="toolbar" aria-label="Formatting">${[['bold','Bold'],['italic','Italic'],['heading','Heading'],['link','Link'],['image','Picture'],['list','List']].map(([name,label])=>`<button type="button" class="buttonsmall" data-format="${name}">${label}</button>`).join('')}<button type="button" class="buttonsmall" data-preview>Preview</button></div><p><label>Your message<br><textarea class="textinput" name="body" maxlength="20000" rows="12" required>${escape(options.body??"")}</textarea></label></p><p class="forum-format-help">Formatting: <code>**bold**</code>, <code>*italic*</code>, <code>## heading</code>, <code>[link](https://…)</code>, <code>![description](https://…)</code>. HTML is displayed as text.</p><div class="editor-preview forum-richtext" aria-live="polite" hidden></div>${button(options.submit??"Post message")}</div>`,"forum-compose-form").replace('class="forum-compose-form"', 'class="forum-compose-form" data-preview-url="/forums/preview"');
}
export function threadControls(actor: ForumActor, thread: ForumThread) {
  if (!moderator(actor)) return "";
  return form(actor,`/forums/threads/${thread.id}/moderate`,`${button(thread.locked?"Unlock":"Lock",thread.locked?"unlock":"lock")} ${button(thread.pinned?"Unpin":"Pin",thread.pinned?"unpin":"pin")} ${button(thread.hidden?"Show thread":"Hide thread",thread.hidden?"unhide":"hide")}`,"forum-moderation-controls");
}
export interface ForumPage {
  kind: "index"|"board"|"thread";
  title: string; description?:string; body: string; controls?:string; footer?:string;
  breadcrumbs?: {title:string;href:string}[]; actor?:ForumActor; query?:string; loginPath?:string;
}
/** Preserve the actual archived frame and forum CSS; replace only its live content. */
export async function renderForum(archive: ArchiveSite|undefined, page: ForumPage) {
  const path = page.kind === "index" ? "m=forum/forums.html" : page.kind === "board" ? "m=forum/sl=0/forums4454.html" : "m=forum/sl=0/forums38a8.html";
  const template = await archive?.template("services.runescape.com",path);
  const login = page.loginPath ?? "/admin/login";
  const account = page.actor ? `<span>Logged in as <b>${escape(page.actor.name)}</b></span> · <a href="/admin">Account</a>${moderator(page.actor)?' · <a href="/forums/moderation">Moderation</a>':""}` : `<a href="${escape(login)}">Administrator login</a> to post.`;
  const picker = `<div class="forum-account">${account}</div><form class="forum-search" method="get" action="/forums/search"><label>Search Threads <input class="textinput" name="q" maxlength="100" value="${escape(page.query??"")}"></label> <button class="buttonsmall" type="submit">Search</button></form>`;
  const nav = `<b>Location:</b> <a href="/">Home</a> &gt; <a href="/forums">2010scape Forums</a>${(page.breadcrumbs??[]).map(c=>` &gt; <a href="${escape(c.href)}">${escape(c.title)}</a>`).join("")}`;
  if (!template) return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(page.title)} - 2010scape Forums</title><link rel="stylesheet" href="/forum.css?v=responsive-1"><script src="/editor.js" defer></script></head><body class="forum-app"><nav>${nav}</nav><main><h1>${escape(page.title)}</h1>${picker}${page.controls??""}${page.body}${page.footer??""}</main></body></html>`;
  const rewriter = new HTMLRewriter()
    .on("title",{element(e){e.setInnerContent(escape(page.title)+" - 2010scape Forums",{html:true});}})
    .on("head",{element(e){e.append('<link rel="stylesheet" href="/forum.css?v=responsive-1"><script src="/editor.js" defer></script>',{html:true});}})
    .on("body",{element(e){e.setAttribute("class",((e.getAttribute("class")??"")+" forum-app").trim());}})
    .on("h1.plaque",{element(e){e.setInnerContent(escape(page.title),{html:true});}})
    .on("#location, .location",{element(e){e.setInnerContent(nav,{html:true});}})
    .on("#picker",{element(e){e.setInnerContent(picker,{html:true});}})
    .on("#infopane",{element(e){e.setInnerContent(`<span class="title">${escape(page.title)}</span>${page.description?`<div class="about">${escape(page.description)}</div>`:""}`,{html:true});}})
    .on("#nocontrols",{element(e){e.remove();}})
    .on(".actions",{element(e){e.setInnerContent(page.controls??"",{html:true});}})
    .on("#uid",{element(e){e.remove();}})
    .on("#login",{element(e){e.setAttribute("href",login);}});
  if (page.kind==="index") rewriter.on("#contentfrm",{element(e){e.setInnerContent(page.body+(page.footer??""),{html:true});}});
  else if (page.kind==="board") rewriter.on("#content_forum .cont",{element(e){e.setInnerContent(page.body+(page.footer??""),{html:true});}});
  else rewriter.on("#contentmsg",{element(e){e.setInnerContent(page.body+(page.footer??""),{html:true});}});
  return rewriter.transform(new Response(template)).text();
}
