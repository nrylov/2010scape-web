import {afterEach,expect,test} from 'bun:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {SQL} from 'bun';
import {createApp} from '../src/app';
import {Store} from '../src/store';
const apps:Awaited<ReturnType<typeof createApp>>[]=[];const dirs:string[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function fixture(){
 const root=await mkdtemp('/private/tmp/2010scape-editorials-');dirs.push(root);
 for(const folder of ['www.runescape.com','services.runescape.com/m=news','services.runescape.com/m=devblog'])await mkdir(join(root,folder),{recursive:true});
 const page=(body:string)=>`<!doctype html><html><head><title>Original</title><link rel="stylesheet" href="../../www.runescape.com/css/original.css"></head><body><a id="community"><span class="ts">Community</span></a><div class="navigation"><div class="location">Historical breadcrumb</div></div><div id="content"><h1 class="plaque">Original plaque</h1>${body}</div><footer>Original border and footer</footer></body></html>`;
 await writeFile(join(root,'www.runescape.com/index.html'),page('<div id="recentnews"><div class="section"></div></div>'));
 await writeFile(join(root,'services.runescape.com/m=news/newsitemc007.html'),page('<div id="newsitemMenu"></div><div id="newsTitle">Historical title</div><div class="adframe">Advertising</div><div class="newsJustify">Historical article</div>'));
 await writeFile(join(root,'services.runescape.com/m=news/list.html'),page('<div id="newsitemMenu"></div><table id="newsList"><tr><td>Historical list</td></tr></table><div class="bottomnav">Page1of51</div>'));
 await writeFile(join(root,'services.runescape.com/m=devblog/view_postfe29.html'),page('<div id="post"><div class="devblog"><div class="devblogHead"><div class="devblogFoot">Historical developer article</div></div></div></div>'));
 await writeFile(join(root,'services.runescape.com/m=devblog/index.html'),page('<form class="navArrows">Oldpages</form><div id="list">Historical developer list</div><form id="filter" action="https://historical.invalid" method="get">Oldfilters</form>'));
 const app=await createApp({databaseUrl:':memory:',archiveRoot:root,adminPassword:'editor password'});apps.push(app);return app;
}
const request=(path:string,cookie?:string,form?:Record<string,string>)=>new Request('http://localhost'+path,{method:form?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(form?{'content-type':'application/x-www-form-urlencoded',origin:'http://localhost'}:{})},body:form?new URLSearchParams(form):undefined});
async function login(app:Awaited<ReturnType<typeof createApp>>){const initial=await app.handle(request('/admin/login'));const csrf=(await initial.text()).match(/name="csrf" value="([^"]+)"/)![1]!;const cookie=initial.headers.get('set-cookie')!.split(';')[0]!;const signed=await app.handle(request('/admin/login',cookie,{csrf,password:'editor password'}));const adminCookie=signed.headers.get('set-cookie')!.split(';')[0]!;const body=await(await app.handle(request('/admin',adminCookie))).text();return{cookie:adminCookie,csrf:body.match(/name="csrf" value="([^"]+)"/)![1]!};}
test('news and developer posts use their original article/list structures and separate draft visibility',async()=>{
 const app=await fixture();
 const news=await app.store.save({title:'News with formatting',body:'## A heading\n\n**Bold** with ![picture](/archive/www.runescape.com/image.png)',state:'published',kind:'news',format:'markdown',category:'Website Updates'});
 const blog=await app.store.save({title:'Our developer blog',body:'*Development* progress.',state:'published',kind:'devblog',format:'markdown',author:'Developer One',project:'Client',tags:'graphics, engine'});
 const draft=await app.store.save({title:'Private developer draft',body:'Hidden work',state:'draft',kind:'devblog',format:'markdown'});
 const article=await(await app.handle(request('/news/'+news))).text();expect(article).toContain('class="newsJustify editorial-body"');expect(article).toContain('<h3>A heading</h3>');expect(article).toContain('<strong>Bold</strong>');expect(article).toContain('src="/assets/site/image.png"');expect(article).not.toContain('Historical article');expect(article).not.toContain('Historical breadcrumb');expect(article).toContain('News List</a> &gt; News with formatting');expect(article).not.toContain('Advertising');expect(article).toContain('Original border and footer');
 const list=await(await app.handle(request('/news'))).text();expect(list).toContain('id="newsList"');expect(list).toContain('News with formatting');expect(list).not.toContain('Our developer blog');expect(list).not.toContain('Page1of51');
 const blogPage=await(await app.handle(request('/devblog/'+blog))).text();expect(blogPage).toContain('class="devblogFoot"');expect(blogPage).toContain('<em>Development</em>');expect(blogPage).toContain('Developer One');expect(blogPage).toContain('Client');expect(blogPage).toContain('Developer Blogs</a> &gt; Our developer blog');expect(blogPage).not.toContain('Historical developer article');
 const blogs=await(await app.handle(request('/devblog?tag=graphics'))).text();expect(blogs).toContain('class="listPost"');expect(blogs).toContain('Our developer blog');expect(blogs).not.toContain('Private developer draft');expect(blogs).not.toContain('News with formatting');
 expect((await app.handle(request('/devblog/'+draft))).status).toBe(404);expect((await app.handle(request('/news/'+blog))).status).toBe(404);
 expect((await app.handle(request('/archive/services.runescape.com/m%3dnews/list.html'))).headers.get('location')).toBe('/news');
});
test('rich editor previews require admin and CSRF and posts retain their formatting metadata',async()=>{
 const app=await fixture();const auth=await login(app);
 const editor=await(await app.handle(request('/admin/announcements/new',auth.cookie))).text();expect(editor).toContain('data-format="bold"');expect(editor).toContain('data-format="image"');expect(editor).toContain('/editor.js');expect(editor).toContain('name="kind"');
 const denied=await app.handle(request('/admin/preview',auth.cookie,{csrf:'wrong',body:'**private**',format:'markdown'}));expect(denied.status).toBe(403);
 const preview=await app.handle(request('/admin/preview',auth.cookie,{csrf:auth.csrf,body:'**Safe** <img src=x onerror=evil()>',format:'markdown'}));expect(preview.status).toBe(200);const html=(await preview.json()).html;expect(html).toContain('<strong>Safe</strong>');expect(html).not.toContain('<img');
 const saved=await app.handle(request('/admin/announcements',auth.cookie,{csrf:auth.csrf,title:'Saved blog',body:'## Heading\n\nText',state:'draft',kind:'devblog',format:'markdown',author:'Author',project:'Farming',tags:'skills, crops',summary:'A short introduction'}));expect(saved.status).toBe(303);const row=(await app.store.list(true,'devblog'))[0]!;expect(row.author).toBe('Author');expect(row.project).toBe('Farming');expect(row.format).toBe('markdown');expect(row.summary).toBe('A short introduction');expect((await app.store.list(false,'devblog')).length).toBe(0);
});
test('existing SQLite announcements migrate as plain news without reinterpreting Markdown',async()=>{
 const directory=await mkdtemp('/private/tmp/2010scape-editorial-migration-');dirs.push(directory);const url='sqlite://'+join(directory,'old.sqlite');const old=new SQL(url);await old`CREATE TABLE announcements (id TEXT PRIMARY KEY,title TEXT,body TEXT,state TEXT,created_at BIGINT,updated_at BIGINT,published_at BIGINT)`;await old`INSERT INTO announcements VALUES ('old','Old post','**literal**','published',1,1,1)`;await old.close();const store=await Store.open(url);try{const row=await store.get('old');expect(row?.format).toBe('plain');expect(row?.kind).toBe('news');expect(row?.body).toBe('**literal**');}finally{await store.close();}
});
test('application connects administrator publishing, forum controls and safe composer previews',async()=>{
 const app=await fixture(),auth=await login(app);
 expect((await app.handle(request('/forums'))).status).toBe(200);
 expect((await app.handle(request('/account/login'))).status).toBe(404);
 expect((await app.handle(request('/forum.css'))).status).toBe(200);
 const compose=await(await app.handle(request('/forums/boards/general/new',auth.cookie))).text();
 expect(compose).toContain('data-format="bold"');expect(compose).toContain('data-format="image"');expect(compose).toContain('data-preview-url="/forums/preview"');
 const preview=await app.handle(request('/forums/preview',auth.cookie,{csrf:auth.csrf,body:'**Hello** *world* ![a](javascript:bad)'}));
 expect(preview.status).toBe(200);expect((await preview.json()).html).toContain('<strong>Hello</strong> <em>world</em>');
 expect((await app.handle(request('/forums/preview',auth.cookie,{csrf:'bad',body:'x'}))).status).toBe(403);
 const created=await app.handle(request('/forums/boards/general/threads',auth.cookie,{csrf:auth.csrf,title:'Integrated thread',body:'## Heading\n\nAn **original** adventure.'}));
 expect(created.status).toBe(303);
 const thread=await(await app.handle(request(created.headers.get('location')!))).text();
 expect(thread).toContain('Integrated thread');expect(thread).toContain('<strong>original</strong>');
 expect(thread).not.toContain('forum-avatar');
});
test('invalid publication preserves the author’s unsaved text and post settings',async()=>{
 const app=await fixture(),auth=await login(app);
 const response=await app.handle(request('/admin/announcements',auth.cookie,{csrf:auth.csrf,title:'',body:'An **unfinished** article',state:'draft',kind:'devblog',format:'markdown',author:'Writer',project:'World',tags:'test',summary:'Draft summary'}));
 expect(response.status).toBe(400);const html=await response.text();expect(html).toContain('An **unfinished** article');expect(html).toContain('Draft summary');expect(html).toContain('value="devblog" selected');expect(html).toContain('action="/admin/announcements"');
});

test('developer blog filters replace the disabled archived form and retain original control layout',async()=>{
 const app=await fixture();
 await app.store.save({title:'Skill blog',body:'Skill work',state:'published',kind:'devblog',author:'Writer',project:'Skills',tags:'development'});
 await app.store.save({title:'Quest blog',body:'Quest work',state:'published',kind:'devblog',author:'Other',project:'Quests',tags:'quests'});
 const html=await(await app.handle(request('/devblog?project=Skills'))).text();
 expect(html).toContain('Skill blog');expect(html).not.toContain('Quest blog');
 const filter=html.match(/<form id="filter"[\s\S]*?<\/form>/)![0];
 expect(filter).toContain('action="/devblog"');expect(filter).not.toContain('inert');expect(filter).not.toContain('disabled');expect(filter.match(/<form/g)).toHaveLength(1);
 expect(filter).toContain('id="filterAuthor"');expect(filter).toContain('id="filterProject"');expect(filter).toContain('id="filterTag"');expect(filter).toContain('/img/devblog/filter.png');expect(filter).toContain('value="Skills" selected');
});
