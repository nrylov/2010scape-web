import { afterEach, expect, test } from "bun:test";
import { SQL } from "bun";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { ArchiveSite } from "../src/archive";
import { createForum, type ForumActor } from "../src/forum";
import { ForumStore } from "../src/forum/store";

const resources: { sql:SQL; directory?:string }[]=[];
afterEach(async()=>{for(const r of resources.splice(0)){await r.sql.close();if(r.directory)await rm(r.directory,{recursive:true,force:true});}});
const actors: Record<string,ForumActor>={
  alice:{id:"alice",name:"Alice",role:"member",csrf:"alice-csrf"},
  bob:{id:"bob",name:"Bob",role:"member",csrf:"bob-csrf"},
  admin:{id:"site-admin",name:"Administrator",role:"admin",csrf:"admin-csrf"},
};
async function fixture(archive?:ArchiveSite) {
  const sql=new SQL(":memory:");resources.push({sql});
  const forum=await createForum({sql,archive,authenticate:async req=>actors[req.headers.get("x-test-user")??""]});
  const get=(path:string,user?:string,method="GET")=>forum.handle(new Request("http://localhost"+path,{method,headers:user?{"x-test-user":user}:{}}));
  const post=(path:string,values:Record<string,string>,user?:string,origin="http://localhost")=>forum.handle(new Request("http://localhost"+path,{method:"POST",headers:{Origin:origin,...(user?{"x-test-user":user}:{})},body:new URLSearchParams(values)}),"127.0.0.1");
  const create=async(title="A new adventure",user="alice")=>{
    const r=(await post("/forums/boards/general/threads",{title,body:"The first **post**",csrf:actors[user]!.csrf},user))!;
    expect(r.status).toBe(303);return r.headers.get("location")!.split("/").at(-1)!;
  };
  return {sql,...forum,get,post,create};
}

test("forum: game identity boundary, CSRF and ownership protect live threads and edit history",async()=>{
  const f=await fixture();
  expect((await f.get("/forums"))!.status).toBe(200);
  expect((await f.get("/forums/boards/general/new"))!.headers.get("location")).toStartWith("/admin/login?returnTo=");
  expect((await f.post("/forums/boards/general/threads",{title:"No",body:"No",csrf:"x"}))!.status).toBe(401);
  expect((await f.post("/forums/boards/general/threads",{title:"No",body:"No",csrf:"bad"},"alice"))!.status).toBe(403);
  expect((await f.post("/forums/boards/general/threads",{title:"No",body:"No",csrf:"alice-csrf"},"alice","https://evil.invalid"))!.status).toBe(403);
  expect((await f.get("/forums",undefined,"PUT"))!.status).toBe(405);
  expect((await f.get("/forums?page=-1"))!.status).toBe(200); // The index has no pagination.
  expect((await f.get("/forums/boards/general?page=-1"))!.status).toBe(400);
  const id=await f.create("<script>alert(1)</script>");
  const thread=(await f.get(`/forums/threads/${id}`))!, html=await thread.text();
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("<strong>post</strong>");
  const first=(await f.store.posts(id)).rows[0]!;
  expect((await f.post(`/forums/posts/${first.id}/edit`,{body:"Stolen",csrf:"bob-csrf"},"bob"))!.status).toBe(403);
  expect((await f.get(`/forums/posts/${first.id}/edit`,"bob"))!.status).toBe(403);
  expect((await f.post(`/forums/posts/${first.id}/edit`,{body:"Updated post",csrf:"alice-csrf"},"alice"))!.status).toBe(303);
  expect((await f.store.post(first.id))!.body).toBe("Updated post");
  const edits=await f.sql`SELECT * FROM forum_post_edits WHERE post_id=${first.id}`;
  expect(edits).toHaveLength(1);expect(edits[0].previous_body).toBe("The first **post**");
  expect((await f.post(`/forums/threads/${id}/replies`,{body:"<img src=x onerror=alert(1)> [bad](javascript:alert) ![pic](https://example.com/p.png)",csrf:"bob-csrf"},"bob"))!.status).toBe(303);
  const replyHtml=await (await f.get(`/forums/threads/${id}`))!.text();
  expect(replyHtml).toContain("&lt;img src=x onerror=alert(1)&gt;");
  expect(replyHtml).not.toContain('href="javascript:');
  expect(replyHtml).toContain('src="https://example.com/p.png"');
  expect((await f.get(`/forums/threads/${id}`,undefined,"HEAD"))!.body).toBeNull();
});

test("forum: moderator permissions, locks, pins, hidden posts and bans are persisted and audited",async()=>{
  const f=await fixture(),id=await f.create();
  expect((await f.post("/forums/boards/announcements/threads",{title:"Official",body:"Text",csrf:"alice-csrf"},"alice"))!.status).toBe(403);
  expect((await f.post(`/forums/threads/${id}/moderate`,{action:"lock",csrf:"bob-csrf"},"bob"))!.status).toBe(403);
  await f.get("/forums","bob");
  expect((await f.post("/forums/moderation/roles",{account:"bob",role:"moderator",csrf:"admin-csrf"},"admin"))!.status).toBe(303);
  expect((await f.post(`/forums/threads/${id}/moderate`,{action:"lock",csrf:"bob-csrf"},"bob"))!.status).toBe(303);
  expect((await f.post(`/forums/threads/${id}/replies`,{body:"Blocked",csrf:"alice-csrf"},"alice"))!.status).toBe(403);
  const first=(await f.store.posts(id)).rows[0]!;
  expect((await f.post(`/forums/posts/${first.id}/edit`,{body:"Blocked",csrf:"alice-csrf"},"alice"))!.status).toBe(403);
  expect((await f.post(`/forums/threads/${id}/replies`,{body:"Moderator update",csrf:"bob-csrf"},"bob"))!.status).toBe(303);
  await Promise.all([f.store.moderate(actors.admin!,"thread",id,"pin"),f.store.moderate(actors.admin!,"thread",id,"hide")]);
  const state=await f.store.thread(id,true);expect(state!.pinned).toBe(1);expect(state!.locked).toBe(1);expect(state!.hidden).toBe(1);
  expect((await f.get(`/forums/threads/${id}`))!.status).toBe(404);
  expect((await f.get(`/forums/threads/${id}`,"bob"))!.status).toBe(200);
  const before=(await f.store.boards()).find(b=>b.id==="general")!;expect(before.thread_count).toBe(0);
  await f.store.moderate(actors.admin!,"thread",id,"unhide");
  await f.store.moderate(actors.admin!,"thread",id,"unlock");
  expect((await f.post(`/forums/posts/${first.id}/moderate`,{action:"hide",csrf:"bob-csrf"},"bob"))!.status).toBe(303);
  const publicHtml=await (await f.get(`/forums/threads/${id}`))!.text();
  expect(publicHtml).not.toContain("The first <strong>post</strong>");
  const modHtml=await (await f.get(`/forums/threads/${id}`,"bob"))!.text();expect(modHtml).toContain("Hidden from public view");
  expect((await f.post("/forums/moderation/roles",{account:"alice",role:"banned",csrf:"bob-csrf"},"bob"))!.status).toBe(403);
  expect((await f.post("/forums/moderation/roles",{account:"alice",role:"banned",csrf:"admin-csrf"},"admin"))!.status).toBe(303);
  expect((await f.post(`/forums/threads/${id}/replies`,{body:"No",csrf:"alice-csrf"},"alice"))!.status).toBe(403);
  expect((await f.get("/forums","alice"))!.status).toBe(200);
  expect((await f.sql`SELECT * FROM forum_moderation`).length).toBeGreaterThanOrEqual(8);
  expect((await f.sql`SELECT * FROM forum_posts WHERE thread_id=${id}`).length).toBe(2);
});

test("forum: post ordering, bounded pagination, title search and write throttling",async()=>{
  const f=await fixture(),id=await f.create("Fishing around Lumbridge");
  for(let n=1;n<=11;n++)await f.store.reply(actors.bob!,id,`Reply ${n}`);
  const first=await f.store.posts(id,1),second=await f.store.posts(id,2);
  expect(first.rows).toHaveLength(10);expect(second.rows).toHaveLength(2);expect(first.rows[0]!.body).toBe("The first **post**");expect(second.rows.at(-1)!.body).toBe("Reply 11");
  expect(first.total).toBe(12);
  const html=await (await f.get(`/forums/threads/${id}?page=2`))!.text();expect(html).toContain("Page 2 of 2");expect(html).toContain("Reply 11");
  const search=await (await f.get("/forums/search?q=Fishing"))!.text();expect(search).toContain("Fishing around Lumbridge");
  expect((await f.get("/forums/search?q="+"a".repeat(101)))!.status).toBe(400);
  for(let n=0;n<9;n++)expect((await f.post(`/forums/threads/${id}/replies`,{body:`Fast reply ${n}`,csrf:"alice-csrf"},"alice"))!.status).toBe(303);
  expect((await f.post(`/forums/threads/${id}/replies`,{body:"One too many",csrf:"alice-csrf"},"alice"))!.status).toBe(429);
  expect((await f.store.posts(id)).total).toBe(21);
});

test("forum: templates keep original forum containers/assets while old posts and forms are replaced",async()=>{
  const directory=await mkdtemp("/private/tmp/2010scape-forum-template-");
  const root=join(directory,"reference");
  await mkdir(join(root,"www.runescape.com"),{recursive:true});await mkdir(join(root,"services.runescape.com/m=forum/sl=0"),{recursive:true});
  await writeFile(join(root,"www.runescape.com/index.html"),"<html><head></head><body><div id=content></div></body></html>");
  const html='<html><head><link rel="stylesheet" href="../../../www.runescape.com/css/forum.css"><script>evil()</script></head><body><div id="location">Old location</div><div id="picker"><form action="https://old.invalid"><input></form></div><h1 class="plaque">Old title</h1><div id="infopane">372 historical active users</div><div id="nocontrols"></div><div class="actions">Old controls</div><div id="contentfrm">Old index</div><div id="content_forum"><div class="cont">Old threads</div></div><div id="contentmsg">Old private posts</div><div id="footer">Original footer</div></body></html>';
  for(const file of ["forums.html","sl=0/forums4454.html","sl=0/forums38a8.html"])await writeFile(join(root,"services.runescape.com/m=forum",file),html);
  const archive=await ArchiveSite.load(root),f=await fixture(archive);resources.at(-1)!.directory=directory;
  const id=await f.create();
  for(const path of ["/forums","/forums/boards/general",`/forums/threads/${id}`]) {
    const source=await (await f.get(path,"alice"))!.text();
    expect(source).toContain("Original footer");expect(source).toContain('class="forum-app"');expect(source).toContain('/archive/www.runescape.com/css/forum.css');expect(source).not.toContain("<script>");expect(source).not.toContain("372 historical active users");
  }
  const thread=await (await f.get(`/forums/threads/${id}`,"alice"))!.text();expect(thread).toContain('class="message"');expect(thread).not.toContain("Old private posts");expect(thread).toContain('name="csrf"');expect(thread).not.toContain('action="https://old.invalid"');
  expect((await f.get("/forum.css"))!.headers.get("content-type")).toContain("text/css");
});

test("forum: content and independently assigned forum roles survive a database reopen",async()=>{
  const directory=await mkdtemp("/private/tmp/2010scape-forum-persistence-"),path=join(directory,"forum.sqlite");
  const sql=new SQL(`sqlite://${path}`),store=await ForumStore.init(sql);
  await store.identify(actors.alice!);const id=await store.create(actors.alice!,"general","Persistent story","This remains.");
  await store.setRole(actors.admin!,"alice","moderator");await sql.close();
  const reopened=new SQL(`sqlite://${path}`);resources.push({sql:reopened,directory});const second=await ForumStore.init(reopened);
  expect((await second.thread(id))!.title).toBe("Persistent story");expect((await second.posts(id)).rows[0]!.body).toBe("This remains.");
  expect((await second.identify(actors.alice!)).role).toBe("moderator");
  expect((await second.identify(actors.bob!)).role).toBe("member");
});
