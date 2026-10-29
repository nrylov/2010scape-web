import {nativeSourcePath, SOURCE_BY_NAMESPACE} from "./site-routes";
import type { Announcement, PostKind } from "./store";
import { contentExcerpt } from "./richtext";
import { realpath, readFile, stat, readdir } from "node:fs/promises";
import { resolve, relative, extname, sep, isAbsolute } from "node:path";

// Archive-owned domains only: no social widgets, advertising CDNs or analytics.
const hosts = new Set([
  "www.runescape.com",
  "news.runescape.com",
  "secure.runescape.com",
  "services.runescape.com",
  "services.jagex.com",
  "www.jagex.com",
  "www.jagexstore.com",
  "www.runefest.com",
  "www.funorb.com",
]);
const extensions = new Set([
  ".html",
  ".htm",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
]);
const blocked =
  /(?:^|\/)(?:cookies?(?:[.\/]|$)|hts[-_]|logs?(?:[.\/]|$)|auth(?:[.\/]|$)|config(?:[.\/]|$)|login[^/]*|m=weblogin|m=create|account_management|email_registration|password[^/]*)(?:[^/]*)/i;
const latin1 = new TextDecoder("windows-1252");
const escaped = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const contained = (root: string, file: string) => {
  const path = relative(root, file);
  return path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
};

const editorialDate = (stamp:number) => new Date(Number(stamp)).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).replaceAll(' ','-');
const CATEGORIES = ['Game Updates','Website Updates','Customer Support','Technical','Community','Behind the Scenes'];
const newsIcon = (category:string) => ({'Game Updates':'mini_game_updates.gif','Website Updates':'mini_website.gif','Customer Support':'mini_customer_support.gif','Technical':'mini_technical.gif','Community':'mini_all_categories.gif','Behind the Scenes':'mini_behind_the_scenes.gif'}[category] ?? 'mini_all_categories.gif');
const newsCategories = () => ['All Categories',...CATEGORIES].map(category=>`<span class="newsNavcat"><img src="/assets/site/img/news/${newsIcon(category)}" alt="">&nbsp;<a class="white" href="/news${category==='All Categories'?'':'?category='+encodeURIComponent(category)}">${escaped(category)}</a></span>`).join(' ')+'<br><hr>';
const editorialPager = (base:string,options:{page:number;pages:number;category?:string;author?:string;project?:string;tag?:string}) => {
 const href=(page:number)=>{const query=new URLSearchParams();for(const key of ['category','author','project','tag'] as const)if(options[key])query.set(key,options[key]!);query.set('page',String(page));return base+'?'+escaped(query.toString());};
 return `<nav class="editorial-pagination" aria-label="Pages">${options.page>1?`<a href="${href(options.page-1)}">‹ Previous</a>`:''} <span>Page ${options.page} of ${options.pages}</span> ${options.page<options.pages?`<a href="${href(options.page+1)}">Next ›</a>`:''}</nav>`;
};

export class ArchiveSite {
  private readonly pageRoutes = new Map<string, {host:string;path:string}>();
  private readonly sourceRoutes = new Map<string,string>();
  private constructor(
    readonly root: string,
    private readonly index: string,
  ) {}
  static async load(
    root = resolve(import.meta.dir, "../local/website-reference/2010-07-18"),
  ): Promise<ArchiveSite | undefined> {
    try {
      const canonical = await realpath(root);
      const indexPath = await realpath(
        resolve(canonical, "www.runescape.com/index.html"),
      );
      if (!contained(canonical, indexPath)) return undefined;
      const site = new ArchiveSite(canonical, latin1.decode(await readFile(indexPath)));
      await site.indexPages();
      return site;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  private async indexPages() {
    for (const host of hosts) {
      let entries;
      try { entries=await readdir(resolve(this.root,host),{recursive:true,withFileTypes:true}); }
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
      for (const entry of entries.filter(e=>e.isFile() && /\.html?$/i.test(e.name)).sort((a,b)=>(a.parentPath+'/'+a.name)<(b.parentPath+'/'+b.name)?-1:1)) {
        const path=relative(resolve(this.root,host),resolve(entry.parentPath,entry.name)).split(sep).join('/');
        if(blocked.test(path))continue;
        const base=nativeSourcePath(host,path);
        // Live application pages have their own renderers, and take precedence.
        if(['/', '/play','/news','/devblog','/forums','/grand-exchange','/hiscores'].includes(base)) {this.sourceRoutes.set(host+'/'+path,base);continue;}
        let route=base;
        if(this.pageRoutes.has(route))route=base+'-'+new Bun.CryptoHasher('sha256').update(host+'/'+path).digest('hex').slice(0,12);
        this.pageRoutes.set(route,{host,path});this.sourceRoutes.set(host+'/'+path,route);
      }
    }
  }
  /** Canonical route inventory used by the link audit; source files remain private. */
  nativePages(){return [...this.pageRoutes.keys()];}
  private canonical(host:string,path:string){
    return this.sourceRoutes.get(host+'/'+path) ?? this.sourceRoutes.get(host+'/'+path.replace(/\.ws$/i,'.html')) ?? this.sourceRoutes.get(host+'/'+path+'.html') ?? nativeSourcePath(host,path);
  }
  /** Resolve the mirror's relative cross-host links without ever producing a remote URL. */
  private url(value: string, host: string, path: string): string | undefined {
    const input = value.trim();
    if (!input || input.startsWith("#")) return input;
    if (
      /[\u0000-\u0020\u007f]/.test(input.replace(/ /g, "")) ||
      input.includes("\\")
    )
      return undefined;
    let targetHost = host,
      targetPath: string,
      hash = "";
    try {
      if (/^[a-z][a-z0-9+.-]*:/i.test(input) || input.startsWith("//")) {
        const target = new URL(input, "https://" + host + "/");
        if (
          !["http:", "https:"].includes(target.protocol) ||
          target.username ||
          target.password ||
          target.port
        )
          return undefined;
        targetHost = target.hostname.toLowerCase();
        targetPath = target.pathname;
        hash = target.hash;
      } else if (input.startsWith("/archive/")) {
        const target = new URL(input, "https://mirror.invalid");
        const parts = target.pathname.slice(9).split("/");
        targetHost = parts.shift()!;
        targetPath = "/" + parts.join("/");
        hash = target.hash;
      } else if (input.startsWith("/")) {
        const target = new URL(input, "https://" + host);
        targetPath = target.pathname;
        hash = target.hash;
      } else {
        const target = new URL(
          input,
          "https://mirror.invalid/" + host + "/" + path,
        );
        const parts = target.pathname.slice(1).split("/");
        targetHost = parts.shift()!;
        targetPath = "/" + parts.join("/");
        hash = target.hash;
      }
      if (!hosts.has(targetHost)) return undefined;
      const decoded = decodeURIComponent(targetPath);
      if (
        decoded.includes("\\") ||
        decoded.includes("\0") ||
        decoded.split("/").some((part) => part === ".." || part === ".")
      )
        return undefined;
      if (blocked.test(decoded)) return undefined;
      return this.canonical(targetHost,decoded.replace(/^\//,'')) + hash;
    } catch {
      return undefined;
    }
  }
  private css(source: string, host: string, path: string): string {
    return source
      .replace(
        /url\(\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\)\s]*))\s*\)/gi,
        (_all, a, b, c) => {
          const url = this.url(a ?? b ?? c ?? "", host, path);
          return `url("${url?.replace(/"/g, "%22") ?? ""}")`;
        },
      )
      .replace(/@import\s+(["'])([^"']+)\1/gi, (_all, _quote, value) => {
        const url = this.url(value, host, path);
        return url
          ? `@import "${url.replace(/"/g, "%22")}"`
          : '@import url("")';
      })
      .replace(/(?:behavior|-moz-binding)\s*:[^;}]+[;}]?/gi, "");
  }
  private async sanitize(
    source: string,
    host: string,
    path: string,
    historical = false,
  ): Promise<string> {
    const site = this;
    // Inline CSS imports are relative to the source document, not to the app route.
    source = source.replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
      (_all, open, css, close) => open + this.css(css, host, path) + close,
    );
    const rewriter = new HTMLRewriter()
      .on("script,iframe,object,embed,applet,base,frame,frameset,#advert", {
        element(element) {
          element.remove();
        },
      })
      .on('link[rel="alternate"]', {
        element(element) {
          if ((element.getAttribute("type") ?? "").includes("rss")) element.remove();
        },
      })
      .on("meta", {
        element(element) {
          if (element.getAttribute("http-equiv")) element.remove();
          if (element.getAttribute("charset"))
            element.setAttribute("charset", "utf-8");
        },
      })
      .on("*", {
        element(element) {
          for (const [attribute, value] of [...element.attributes]) {
            const name = attribute.toLowerCase();
            if (
              name.startsWith("on") ||
              [
                "srcdoc",
                "srcset",
                "ping",
                "formaction",
                "action",
                "target",
                "manifest",
              ].includes(name)
            ) {
              element.removeAttribute(attribute);
              continue;
            }
            if (
              ["href", "src", "background", "poster", "xlink:href"].includes(
                name,
              )
            ) {
              const mapped = site.url(value, host, path);
              if (mapped === undefined) element.removeAttribute(attribute);
              else element.setAttribute(attribute, mapped);
            }
            if (name === "style")
              element.setAttribute(attribute, site.css(value, host, path));
          }
        },
      })
      .on("form", {
        element(element) {
          element.setAttribute("data-archive-disabled", "true");
          element.setAttribute("inert", "");
          element.setAttribute("aria-disabled", "true");
          element.setAttribute("action", "#");
        },
      })
      .on("input,button,select,textarea", {
        element(element) {
          element.setAttribute("disabled", "");
        },
      })
      .on("head", {
        element(element) {
          element.prepend(
            '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
            { html: true },
          );
          element.append('<link rel="stylesheet" href="/site-overrides.css">', {
            html: true,
          });
        },
      })
      .on("#home", {
        element(element) {
          element.setAttribute("href", "/");
        },
      })
      .on("#play,#playExisting,#bannerPlay,#playBannerNoad,#banner .bannerLink", {
        element(element) {
          element.setAttribute("href", "/play");
        },
      })
      .on("#login", {
        element(element) {
          element.setAttribute("href", "/admin");
        },
      })
      .on("#community", {
        element(element) {
          element.setAttribute("href", "/forums");
        },
      })
      .on("#community > .ts", {
        element(element) {
          element.setInnerContent("Community");
        },
      })
      .on("#players", {
        element(element) {
          element.setInnerContent(
            'Game world status is not configured. <a href="/status">Server status</a>',
            { html: true },
          );
        },
      })
      .onDocument({
        comments(comment) {
          comment.remove();
        },
      });
    if (historical)
      rewriter.on("body", {
        element(element) {
          element.prepend(
            '<aside class="site-archive-notice" role="note">Historical website reference from July 2010. Old announcements, account services and forms are not live. <a href="/">Return to 2010scape</a></aside>',
            { html: true },
          );
        },
      });
    return rewriter.transform(new Response(source)).text();
  }
  async renderHome(
    announcementsMarkup: string,
    statusMarkup?: string,
  ): Promise<string> {
    const clean = await this.sanitize(
      this.index,
      "www.runescape.com",
      "index.html",
    );
    const rewriter = new HTMLRewriter().on("#recentnews > .section", {
      element(element) {
        element.setInnerContent(announcementsMarkup, { html: true });
      },
    });
    if (statusMarkup !== undefined)
      rewriter.on("#players", {
        element(element) {
          element.setInnerContent(statusMarkup, { html: true });
        },
      });
    return rewriter.transform(new Response(clean)).text();
  }
  async renderPage(title: string, appBody: string): Promise<string> {
    const clean = await this.sanitize(
      this.index,
      "www.runescape.com",
      "index.html",
    );
    return new HTMLRewriter()
      .on("title", {
        element(element) {
          element.setInnerContent(escaped(title) + " - 2010scape", {
            html: true,
          });
        },
      })
      .on("body", {
        element(element) {
          element.setAttribute(
            "class",
            (element.getAttribute("class") ?? "") + " site-app-page",
          );
        },
      })
      .on("#content", {
        element(element) {
          element.setInnerContent(
            '<main class="site-app-content">' + appBody + "</main>",
            { html: true },
          );
        },
      })
      .transform(new Response(clean))
      .text();
  }
  /** Sanitized original page for live features which replace its historical content. */
  async template(host: string, path: string): Promise<string | undefined> {
    if (!hosts.has(host) || !/\.html?$/.test(path) || path.split('/').some(part => part === '..' || part === '.')) return undefined;
    try {
      const file = await realpath(resolve(this.root, host, path));
      if (!contained(this.root, file)) return undefined;
      return this.sanitize(latin1.decode(await readFile(file)), host, path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  async renderEditorial(row: Announcement, body: string, navigation = ''): Promise<string | undefined> {
    const blog = row.kind === 'devblog';
    const path = blog ? 'm=devblog/view_postfe29.html' : 'm=news/newsitemc007.html';
    const clean = await this.template('services.runescape.com', path)
      ?? (!blog ? await this.template('services.runescape.com', 'm=news/newsitem13fe.html') : undefined);
    if (!clean) return undefined;
    const stamp = editorialDate(row.published_at!), title = escaped(row.title);
    const metadata = blog ? `<div id="archives"><a href="/devblog">&lt; Back to archive</a></div><h2>${title}<br>by ${escaped(row.author)} ${stamp}</h2><div class="content editorial-body">${body}</div><br class="clear"><div id="meta">Project: ${escaped(row.project)}<br>Tags: ${escaped(row.tags)}</div>` : body;
    return new HTMLRewriter()
      .on('title', {element(e) {e.setInnerContent(`${title} - 2010scape`, {html:true});}})
      .on('body', {element(e) {e.setAttribute('class', `${e.getAttribute('class') ?? ''} site-editorial-page`);}})
      .on('.navigation .location', {element(e) {e.setInnerContent(`<b>Location: </b><a href="/">Home</a> &gt; <a href="${blog ? '/devblog' : '/news'}">${blog ? 'Developer Blogs' : 'News List'}</a> &gt; ${title}`, {html:true});}})
      .on('.adframe,#feed,#bookmark', {element(e) {e.remove();}})
      .on('#newsitemMenu', {element(e) {e.setInnerContent(newsCategories(), {html:true});}})
      .on('#newsTitle', {element(e) {e.setInnerContent(`${navigation}<b>${stamp} - ${title}</b>`, {html:true});}})
      .on('.newsJustify', {element(e) {e.setAttribute('class','newsJustify editorial-body');e.setInnerContent(metadata, {html:true});}})
      .on('#post .devblogFoot', {element(e) {e.setInnerContent(metadata, {html:true});}})
      .on('h1.plaque', {element(e) {if(blog)e.setInnerContent(title,{html:true});}})
      .transform(new Response(clean)).text();
  }
  async renderEditorialList(kind: PostKind, rows: Announcement[], options: {page:number; pages:number; category?:string; author?:string; project?:string; tag?:string; all:Announcement[]}): Promise<string | undefined> {
    const blog = kind === 'devblog', path = blog ? 'm=devblog/index.html' : 'm=news/list.html';
    const clean = await this.template('services.runescape.com',path);
    if (!clean) return undefined;
    const title = blog ? "Developers' Blogs" : 'Latest News';
    const base = blog ? '/devblog' : '/news';
    const pagination = editorialPager(base,options);
    const entries = blog ? rows.map(row => `<div class="listPost"><h3><span class="postDetails"><a class="postTitle" href="/devblog/${escaped(row.id)}">${escaped(row.title)}</a> by <a class="postAuthor" href="/devblog?author=${encodeURIComponent(row.author)}">${escaped(row.author)}</a></span><span class="postDate">${editorialDate(row.published_at!)}</span></h3><div class="postImage"><img src="/assets/services/m%3ddevblog/images/icon/dev.png" alt="Development"></div><p>${escaped(row.summary || contentExcerpt(row.body))} <a href="/devblog/${escaped(row.id)}">Read&nbsp;More</a></p><div class="postMeta"><b>Project:</b> <a href="/devblog?project=${encodeURIComponent(row.project)}">${escaped(row.project)}</a><br><b>Tags:</b> ${row.tags.split(',').filter(tag=>tag.trim()).map(tag=>`<a href="/devblog?tag=${encodeURIComponent(tag.trim())}">${escaped(tag.trim())}</a>`).join(', ')}</div></div>`).join('') || '<p class="editorial-empty">No developer posts have been published yet.</p>'
      : '<tr class="row_a"><td width="30%" id="titleCat"><b>Category</b></td><td width="50%" id="titleTitle"><b>News Item</b></td><td width="20%" class="date"><b>Date</b></td></tr>' + (rows.map(row=>`<tr class="pad"><td><a class="catLink" href="/news?category=${encodeURIComponent(row.category)}"><img src="/assets/site/img/news/${newsIcon(row.category)}" alt=""><span>${escaped(row.category)}</span></a></td><td><a class="titleLink" href="/news/${escaped(row.id)}">${escaped(row.title)}</a></td><td class="date">${editorialDate(row.published_at!)}</td></tr>`).join('') || '<tr><td colspan="3">No news has been published yet.</td></tr>');
    const select = (name:string,values:string[],selected='') => `<label>${name[0]!.toUpperCase()+name.slice(1)} <select name="${name}"><option value="">All</option>${[...new Set(values)].filter(Boolean).sort().map(value=>`<option value="${escaped(value)}"${selected===value?' selected':''}>${escaped(value)}</option>`).join('')}</select></label>`;
    const filters = `<h3>Filter Posts</h3><div id="filterAuthor">${select('author',options.all.map(r=>r.author),options.author)}</div><div id="filterProject">${select('project',options.all.map(r=>r.project),options.project)}</div><div id="filterTag">${select('tag',options.all.flatMap(r=>r.tags.split(',').map(tag=>tag.trim())),options.tag)}</div><div id="filterButton"><button type="submit"><img src="/assets/site/img/devblog/filter.png" alt="Filter Posts"></button></div><br class="clear">`;
    return new HTMLRewriter()
      .on('title',{element(e){e.setInnerContent(`${escaped(title)} - 2010scape`,{html:true});}})
      .on('body',{element(e){e.setAttribute('class',`${e.getAttribute('class')??''} site-editorial-page`);}})
      .on('#newsitemMenu',{element(e){e.setInnerContent(newsCategories(),{html:true});}})
      .on('#newsList,#list',{element(e){e.setInnerContent(entries,{html:true});}})
      .on('#feed',{element(e){e.remove();}})
      .on('.topnav,.bottomnav,.navArrows',{element(e){e.replace(pagination,{html:true});}})
      .on('#filter',{element(e){e.replace(`<form id="filter" method="get" action="/devblog">${filters}</form>`,{html:true});}})
      .transform(new Response(clean)).text();
  }
  async serve(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    const legacy=url.pathname.startsWith('/archive/');
    const nativePage=this.pageRoutes.get(url.pathname);
    const asset=/^\/assets\/([^/]+)\/(.+)$/.exec(url.pathname);
    if(!legacy&&!nativePage&&!asset)return undefined;
    const missing = () =>
      new Response("Archived file not available", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    let decoded: string;
    try {
      decoded = nativePage ? nativePage.host+'/'+nativePage.path : asset ? (SOURCE_BY_NAMESPACE[asset[1]!]??'invalid')+'/'+decodeURIComponent(asset[2]!) : decodeURIComponent(url.pathname.slice(9));
    } catch {
      return missing();
    }
    const parts = decoded.split("/"),
      host = parts.shift()!;
    if (
      !hosts.has(host) ||
      parts.some((part) => part === ".." || part === ".") ||
      decoded.includes("\\") ||
      decoded.includes("\0") ||
      blocked.test(parts.join("/"))
    )
      return missing();
    if(legacy){
      const canonical=this.canonical(host,parts.join('/'));
      if(this.pageRoutes.has(canonical)||['/play','/forums','/news','/devblog','/grand-exchange','/hiscores'].includes(canonical))return new Response(null,{status:308,headers:{Location:canonical+url.search,'Cache-Control':'public,max-age=3600'}});
    }
    try {
      const hostRoot = await realpath(resolve(this.root, host));
      if (!contained(this.root, hostRoot)) return missing();
      let candidate = resolve(hostRoot, ...parts);
      if (!contained(hostRoot, candidate)) return missing();
      if ((await stat(candidate)).isDirectory())
        candidate = resolve(candidate, "index.html");
      const file = await realpath(candidate);
      if (
        !contained(hostRoot, file) ||
        !extensions.has(extname(file).toLowerCase()) ||
        !(await stat(file)).isFile()
      )
        return missing();
      const extension = extname(file).toLowerCase();
      const relativePath = relative(hostRoot, file).split(sep).join("/");
      if(legacy || (asset && ['.html','.htm'].includes(extension)))return new Response(null,{status:308,headers:{Location:this.canonical(host,relativePath)+url.search,"Cache-Control":"public,max-age=3600"}});
      const headers: Record<string, string> = {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=3600",
        "Content-Security-Policy":
          "default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
      };
      if (extension === ".html" || extension === ".htm") {
        headers["Content-Type"] = "text/html; charset=utf-8";
        headers["Cache-Control"] = "no-store";
        if(request.method==='HEAD')return new Response(null,{headers});
        const html = await this.sanitize(
          latin1.decode(await readFile(file)),
          host,
          relativePath,
          false,
        );
        return new Response(html, {
          headers,
        });
      }
      if (extension === ".css") {
        headers["Content-Type"] = "text/css; charset=utf-8";
        return new Response(request.method==='HEAD'?null:this.css(latin1.decode(await readFile(file)),host,relativePath),{headers});
      }
      return new Response(request.method === "HEAD" ? null : Bun.file(file), {
        headers,
      });
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR", "ELOOP", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        return missing();
      throw error;
    }
  }
}
