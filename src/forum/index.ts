import { renderRichText } from "../richtext";
import type { SQL } from "bun";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { ArchiveSite } from "../archive";
import { ForumStore, ForumError, moderator, type ForumActor } from "./store";
import { renderForum, boardIndex, threadList, posts, compose, threadControls, form, pages, escape, when, type ForumPage } from "./view";
export type { ForumActor, ForumRole } from "./store";

export interface ForumDependencies {
  sql: SQL;
  archive?: ArchiveSite;
  authenticate(request: Request): Promise<ForumActor | undefined>;
  /** Public origin, when behind a reverse proxy. */
  siteOrigin?: string;
  loginPath?: string;
  headers?: HeadersInit;
}
const pageNumber = (url: URL) => {
  const raw = url.searchParams.get("page")??"1";
  if (!/^\d{1,5}$/.test(raw) || +raw < 1 || +raw > 10000) throw new ForumError("Invalid page number.");
  return +raw;
};
const same = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left,right);
};
async function readForm(req: Request) {
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers.get("content-type")??"")) throw new ForumError("Submit the forum form as URL-encoded data.",415);
  if (Number(req.headers.get("content-length")??0)>262144) throw new ForumError("The post is too large.",413);
  const reader = req.body?.getReader();
  if (!reader) throw new ForumError("Missing form data.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>262144){await reader.cancel();throw new ForumError("The post is too large.",413);}
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
const redirect = (path: string) => new Response(null,{status:303,headers:{Location:path,"Cache-Control":"no-store"}});

/** All account authentication is injected; game passwords are never stored here. */
export async function createForum(deps: ForumDependencies) {
  const store = await ForumStore.init(deps.sql);
  const headers = new Headers(deps.headers);
  headers.set("Content-Type","text/html; charset=utf-8");
  headers.set("Cache-Control","no-store");
  headers.set("X-Content-Type-Options","nosniff");
  headers.set("Referrer-Policy","same-origin");
  if(!headers.has("Content-Security-Policy"))headers.set("Content-Security-Policy","default-src 'none'; img-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  const signIn = (returnTo: string) => `${deps.loginPath??"/admin/login"}?returnTo=${encodeURIComponent(returnTo)}`;
  const page = async (input: ForumPage, status=200, head=false) => new Response(head?null:await renderForum(deps.archive,input),{status,headers});
  async function handle(req: Request, ip="local"): Promise<Response|undefined> {
    const url=new URL(req.url), path=url.pathname.replace(/\/$/,"");
    if(path==="/forum.css" && ["GET","HEAD"].includes(req.method))return new Response(req.method==="HEAD"?null:Bun.file(resolve(import.meta.dir,"../../public/forum.css")),{headers:{"Content-Type":"text/css; charset=utf-8","Cache-Control":"public,max-age=3600","X-Content-Type-Options":"nosniff"}});
    if(path!=="/forums"&&!path.startsWith("/forums/"))return;
    let actor: ForumActor|undefined;
    try {
      if(!["GET","HEAD","POST"].includes(req.method))return new Response("Method not allowed",{status:405,headers:{Allow:"GET, HEAD, POST"}});
      const authenticated=await deps.authenticate(req);
      actor=authenticated?await store.identify(authenticated):undefined;
      const mod=actor?moderator(actor):false, head=req.method==="HEAD";
      const base={actor,loginPath:signIn(url.pathname+url.search)};
      if(req.method==="POST") {
        if(!actor)throw new ForumError("Log in before posting.",401);
        if(req.headers.get("origin")!==(deps.siteOrigin??url.origin))throw new ForumError("Invalid request origin.",403);
        const data=await readForm(req);
        if(!same(data.get("csrf")??"",actor.csrf))throw new ForumError("Your form has expired. Reload the page and try again.",403);
        const body=data.get("body")??"";
        if(path==="/forums/preview") {
          if(body.length>20000)throw new ForumError("The post is too large.");
          return Response.json({html:renderRichText(body)},{headers:{"Cache-Control":"no-store"}});
        }
        const create=/^\/forums\/boards\/([a-z0-9-]{1,64})\/threads$/.exec(path);
        const reply=/^\/forums\/threads\/([a-f0-9-]{36})\/replies$/.exec(path);
        const edit=/^\/forums\/posts\/([a-f0-9-]{36})\/edit$/.exec(path);
        const moderation=/^\/forums\/(threads|posts)\/([a-f0-9-]{36})\/moderate$/.exec(path);
        if(create||reply||edit) {
          await store.rate(`account:${actor.id}`,10); await store.rate(`ip:${ip}`,30);
          if(create) {
            const id=await store.create(actor,create[1]!,data.get("title")??"",body);
            return redirect(`/forums/threads/${id}`);
          }
          if(reply) {
            const id=await store.reply(actor,reply[1]!,body), count=(await store.posts(reply[1]!,1,mod)).total;
            return redirect(`/forums/threads/${reply[1]}?page=${Math.max(1,Math.ceil(count/10))}#post-${id}`);
          }
          if(edit) {
            await store.edit(actor,edit[1]!,body);
            const post=await store.post(edit[1]!,mod);
            const all=await deps.sql`SELECT COUNT(*) AS n FROM forum_posts WHERE thread_id=${post!.thread_id} AND position<=${post!.position} AND (${mod?1:0}=1 OR hidden=0)`;
            return redirect(`/forums/threads/${post!.thread_id}?page=${Math.max(1,Math.ceil(Number(all[0].n)/10))}#post-${post!.id}`);
          }
        }
        if(moderation) {
          await store.rate(`moderation:${actor.id}`,60);
          const kind=moderation[1]==="threads"?"thread":"post", id=moderation[2]!;
          const post=kind==="post"?await store.post(id,true):undefined;
          await store.moderate(actor,kind,id,data.get("action")??"");
          return redirect(`/forums/threads/${kind==="thread"?id:post!.thread_id}`);
        }
        if(path==="/forums/moderation/roles") {
          await store.rate(`moderation:${actor.id}`,60);
          await store.setRole(actor,data.get("account")??"",data.get("role")??"");
          return redirect("/forums/moderation");
        }
        throw new ForumError("Forum action not found.",404);
      }
      if(path==="/forums") {
        const jump=url.searchParams.get("thread");
        if(jump && await store.thread(jump,mod))return redirect(`/forums/threads/${jump}`);
        return page({...base,kind:"index",title:"2010scape Forums",description:"The place to discuss your adventures, ask questions and meet other players.",body:boardIndex(await store.categories(),await store.boards(mod))},200,head);
      }
      if(path==="/forums/search") {
        const query=(url.searchParams.get("q")??"").trim();
        if(query.length>100)throw new ForumError("Keep searches under 100 characters.");
        const p=pageNumber(url), results=query?await store.threads(null,p,mod,query):{rows:[],total:0};
        return page({...base,kind:"board",title:"Search Threads",query,description:query?`${results.total} matching threads.`:"Enter a title to search the forums.",body:threadList(results.rows),controls:pages(`/forums/search?q=${encodeURIComponent(query)}`,p,results.total,20)},200,head);
      }
      if(path==="/forums/moderation") {
        if(!actor||!mod)throw new ForumError("Moderator permission required.",403);
        const logs=await deps.sql`SELECT * FROM forum_moderation ORDER BY created_at DESC,id LIMIT 100`;
        const profiles=actor.role==="admin"?await store.profiles():[];
        const controls=actor.role==="admin"?`<h2>Forum account roles</h2><p>These roles apply only to the forum. Game rights do not grant forum moderation.</p>${form(actor,"/forums/moderation/roles",`<label>Account <select name="account">${profiles.map(p=>`<option value="${escape(p.account_id)}">${escape(p.name)} (${escape(p.role)})</option>`).join("")}</select></label> <label>Role <select name="role"><option>member</option><option>moderator</option><option>admin</option><option>banned</option></select></label> <button class="buttonsmall" type="submit">Set role</button>`)}`:"";
        const body=`${controls}<h2>Recent moderation</h2><table class="forum-log"><tr><th>Time</th><th>Action</th><th>Target</th></tr>${logs.map((row: {created_at:number;action:string;detail:string;target_type:string;target_id:string})=>`<tr><td>${when(row.created_at)}</td><td>${escape(row.action)} ${escape(row.detail)}</td><td>${escape(row.target_type)} ${escape(row.target_id)}</td></tr>`).join("")}</table>`;
        return page({...base,kind:"thread",title:"Forum Moderation",body},200,head);
      }
      const board=/^\/forums\/boards\/([a-z0-9-]{1,64})(\/new)?$/.exec(path);
      if(board) {
        const row=await store.board(board[1]!);
        if(!row)throw new ForumError("Board not found.",404);
        const breadcrumbs=[{title:row.title,href:`/forums/boards/${row.id}`}];
        if(board[2]) {
          if(!actor)return redirect(signIn(path));
          if(actor.role==="banned"||((row.locked||row.staff_threads)&&!mod))throw new ForumError("You cannot create threads in this board.",403);
          return page({...base,kind:"thread",title:`New thread – ${row.title}`,breadcrumbs,body:compose(actor,`/forums/boards/${row.id}/threads`,{thread:true,submit:"Create thread"})},200,head);
        }
        const p=pageNumber(url), threads=await store.threads(row.id,p,mod);
        const canPost=actor && actor.role!=="banned" && (!(row.locked||row.staff_threads)||mod);
        const newThread=canPost?`<a class="forum-button" href="/forums/boards/${row.id}/new">Create a new thread</a>`:!actor?`<a href="${escape(signIn(path+"/new"))}">Log in to create a thread</a>`:"";
        return page({...base,kind:"board",title:row.title,description:row.description,breadcrumbs,body:threadList(threads.rows),controls:newThread+pages(`/forums/boards/${row.id}`,p,threads.total,20)},200,head);
      }
      const thread=/^\/forums\/threads\/([a-f0-9-]{36})$/.exec(path);
      if(thread) {
        const row=await store.thread(thread[1]!,mod);
        if(!row)throw new ForumError("Thread not found.",404);
        const board=await store.board(row.board_id),p=pageNumber(url),list=await store.posts(row.id,p,mod);
        const reply=actor&&actor.role!=="banned"&&(!(row.locked||board?.locked)||mod)?`<h2>Reply to this thread</h2>${compose(actor,`/forums/threads/${row.id}/replies`)}`:row.locked?'<p class="forum-notice">This thread is locked.</p>':!actor?`<p><a href="${escape(signIn(path))}">Administrator login</a> to reply.</p>`:"";
        return page({...base,kind:"thread",title:row.title,description:row.hidden?"This thread is hidden from public view.":undefined,breadcrumbs:[{title:board?.title??"Board",href:`/forums/boards/${row.board_id}`}],body:posts(list.rows,row,actor),controls:pages(path,p,list.total,10)+(actor?threadControls(actor,row):""),footer:reply},200,head);
      }
      const edit=/^\/forums\/posts\/([a-f0-9-]{36})\/edit$/.exec(path);
      if(edit) {
        if(!actor)return redirect(signIn(path));
        const post=await store.post(edit[1]!,mod),thread=post?await store.thread(post.thread_id,mod):undefined;
        if(!post||!thread)throw new ForumError("Post not found.",404);
        if(actor.role==="banned"||(!mod&&(post.author_id!==actor.id||thread.locked)))throw new ForumError("You cannot edit this post.",403);
        return page({...base,kind:"thread",title:"Edit post",breadcrumbs:[{title:thread.title,href:`/forums/threads/${thread.id}`}],body:compose(actor,path,{body:post.body,submit:"Save changes"})},200,head);
      }
      throw new ForumError("Forum page not found.",404);
    } catch(error) {
      if(!(error instanceof ForumError))throw error;
      return page({kind:"thread",title:error.status===404?"Not found":"Forum message",actor,loginPath:signIn(path),body:`<p class="forum-notice" role="alert">${escape(error.message)}</p><p><a href="/forums">Return to the forums</a></p>`},error.status,req.method==="HEAD");
    }
  }
  return {store,handle};
}
