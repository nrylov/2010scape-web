import { handleHiscores } from "./hiscores";
import { handleExchange } from "./exchange";
import { createForum } from "./forum";
import {renderContent, type ContentFormat} from "./richtext";
import { Store, ValidationError } from "./store";
import { ArchiveSite } from "./archive";
import { layout, escape, newsList, archiveNews, date, editor, field } from "./view";
import { resolve } from "node:path";
export interface Config {
  databaseUrl?: string;
  adminPassword?: string;
  adminPasswordHash?: string;
  secureCookie?: boolean;
  siteOrigin?: string;
  gameStatusUrl?: string;
  downloadUrl?: string;
  archiveRoot?: string;
}
const digest = (text: string) =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");
const token = () => crypto.randomUUID() + crypto.randomUUID();
export async function createApp(config: Config = {}) {
  const store = await Store.open(config.databaseUrl);
  const archive = await ArchiveSite.load(config.archiveRoot);
  const adminEnabled = !!(config.adminPasswordHash || config.adminPassword);
  const passwordHash =
    config.adminPasswordHash ||
    (config.adminPassword ? await Bun.password.hash(config.adminPassword) : "");
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; script-src 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
  const page = async (title: string, body: string, status = 200, active = "Home") =>
    new Response(archive ? await archive.renderPage(title, body) : layout(title, body, active), { status, headers });
  const redirect = (url: string, cookie?: string) =>
    new Response(null, {
      status: 303,
      headers: {
        Location: url,
        ...(cookie ? { "Set-Cookie": cookie } : {}),
        "Cache-Control": "no-store",
      },
    });
  const cookie = (id: string, age = 28800) =>
    `scape_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.secureCookie ? "; Secure" : ""}`;
  async function session(req: Request) {
    const raw = req.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)scape_session=([a-f0-9-]{72})/)?.[1];
    if (!raw) return undefined;
    return (
      await store.sql`SELECT * FROM sessions WHERE id=${digest(raw)} AND expires_at > ${Date.now()}`
    )[0];
  }
  async function newSession(admin: boolean) {
    const raw = token(),
      csrf = token(),
      now = Date.now();
    await store.sql`DELETE FROM sessions WHERE expires_at < ${now}`;
    await store.sql`DELETE FROM login_limits WHERE expires_at < ${now}`;
    await store.sql`INSERT INTO sessions VALUES (${digest(raw)}, ${csrf}, ${admin ? 1 : 0}, ${now + 8 * 3600_000})`;
    return { raw, csrf };
  }
  const forum = await createForum({sql: store.sql, archive, siteOrigin: config.siteOrigin, loginPath: "/admin/login", headers,
    authenticate: async req => {
      const admin = await session(req);
      if (admin?.admin === 1) return {id: 'website-administrator', name: '2010scape team', role: 'admin', csrf: admin.csrf};
      return undefined;
    },
  });
  async function status() {
    if (!config.gameStatusUrl)
      return {
        state: "Unknown",
        detail: "Game status monitoring has not been configured.",
      };
    try {
      const response = await fetch(config.gameStatusUrl, {
        signal: AbortSignal.timeout(2000),
        headers: { Accept: "application/json" },
        redirect: "error",
      });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as {
        online?: boolean;
        players?: number;
      };
      if (typeof data.online !== "boolean") throw new Error();
      return {
        state: data.online ? "Online" : "Offline",
        detail: data.online
          ? Number.isSafeInteger(data.players) && data.players! >= 0
            ? `${data.players} players online.`
            : "The configured game endpoint reports the world is online."
          : "The configured game endpoint reports the world is offline.",
      };
    } catch {
      return {
        state: "Unknown",
        detail: "The game status endpoint is currently unavailable.",
      };
    }
  }
  async function handle(req: Request, ip = "local"): Promise<Response> {
    const url = new URL(req.url),
      path = url.pathname;
    try {
      if (path === "/healthz") return Response.json({ status: "ok" });
      if (path === "/readyz") {
        const ready = await store.ready();
        return Response.json(
          { status: ready ? "ready" : "unavailable" },
          { status: ready ? 200 : 503 },
        );
      }
      if (req.method === "GET" && path === "/site-overrides.css")
        return new Response(Bun.file(resolve(import.meta.dir, "../public/site-overrides.css")), {
          headers: { "Content-Type": "text/css", "X-Content-Type-Options": "nosniff" },
        });
      if (archive && (req.method === "GET" || req.method === "HEAD")) {
        const response = await archive.serve(req);
        if (response) return response;
      }
      const hiscoresResponse = await handleHiscores(req, archive);
      if (hiscoresResponse) return hiscoresResponse;
      const exchangeResponse = await handleExchange(req, archive);
      if (exchangeResponse) return exchangeResponse;
      const forumResponse = await forum.handle(req, ip);
      if (forumResponse) return forumResponse;
      if (req.method === 'GET' && path === '/editor.js')
        return new Response(Bun.file(resolve(import.meta.dir,'../public/editor.js')), {headers:{'Content-Type':'text/javascript; charset=utf-8','X-Content-Type-Options':'nosniff'}});
      if (req.method === "GET" && path === "/") {
        const rows = await store.list();
        if (archive) {
          const state = await status();
          const body = await archive.renderHome(archiveNews(rows.slice(0, 5)),
            `<b>2010scape</b> · <a href="/status">Game status: ${escape(state.state)}</a>`);
          return new Response(body, { headers });
        }
        return page("Website reference needed", `<section class="panel"><h1>2010scape</h1><p>The original website files are needed to display the 2010 site. Place the extracted date folder at <code>local/website-reference/2010-07-18</code> or set <code>WEBSITE_ARCHIVE_ROOT</code>, then restart.</p><h2>Latest news</h2>${newsList(rows, 5)}</section>`);
      }
      if (req.method === 'GET' && (path === '/news' || path === '/devblog')) {
        const kind = path === '/devblog' ? 'devblog' : 'news';
        const all = await store.list(false,kind);
        const category = url.searchParams.get('category') || undefined, author = url.searchParams.get('author') || undefined;
        const project = url.searchParams.get('project') || undefined, tag = url.searchParams.get('tag') || undefined;
        const filtered = all.filter(row => (!category || row.category===category) && (!author || row.author===author) && (!project || row.project===project) && (!tag || row.tags.split(',').map(value=>value.trim()).includes(tag)));
        const pages = Math.max(1,Math.ceil(filtered.length/20));
        const pageNumber = Math.min(pages,Math.max(1,Math.floor(Number(url.searchParams.get('page')))||1));
        const rows = filtered.slice((pageNumber-1)*20,pageNumber*20);
        const original = await archive?.renderEditorialList(kind,rows,{page:pageNumber,pages,category,author,project,tag,all});
        if (original) return new Response(original,{headers});
        return page(kind==='devblog' ? "Developers' Blogs" : 'Latest news', `<section class="panel"><h1>${kind==='devblog' ? "Developers' Blogs" : 'Latest news'}</h1>${newsList(rows)}</section>`);
      }
      if (req.method === 'GET' && /^\/(news|devblog)\/[^/]+$/.test(path)) {
        const [,kind,id] = path.split('/'), row = await store.get(id!);
        if (row && row.kind === kind) {
          const body = renderContent(row.body,row.format);
          const original = await archive?.renderEditorial(row,body);
          if (original) return new Response(original,{headers});
          return page(row.title, `<article class="panel"><a href="/${kind}">‹ All ${kind==='devblog'?'developer posts':'news'}</a><h1>${escape(row.title)}</h1><time>${date(row.published_at!)}</time><div class="announcement-body editorial-body">${body}</div></article>`);
        }
      }
      if (req.method === "GET" && path === "/play") {
        let download = "";
        try {
          const link = new URL(config.downloadUrl || "");
          if (["http:", "https:"].includes(link.protocol))
            download = `<a class="gold-button" href="${escape(link.href)}">Download the game client</a>`;
        } catch {}
        return page(
          "Play 2010scape",
          `<section class="panel"><h1>Your adventure starts here</h1><p>2010scape uses the original revision 623 Java client.</p>${download || '<div class="notice">A public client download has not been configured yet. Ask the server operator for the current client package and connection details.</div>'}<h2>Getting started</h2><ol><li>Obtain the client package from the server operator${download ? " using the download above" : ""}.</li><li>Follow the Java runtime and launcher instructions supplied with that package.</li><li>Use the world address supplied by the operator, then launch the client and log in.</li></ol><p>Account creation and access are managed by the game server. This website does not create game accounts.</p><p><a href="/status">Check the current server status ›</a></p></section>`,
          200,
          "Play",
        );
      }
      if (req.method === "GET" && path === "/status") {
        const s = await status();
        return page(
          "Server status",
          `<section class="panel"><h1>Server status</h1><div class="status"><span class="status-dot ${s.state.toLowerCase()}"></span><strong>${escape(s.state)}</strong></div><p>${escape(s.detail)}</p><p class="hint">Website availability does not imply that the game world is online.</p></section>`,
          200,
          "Status",
        );
      }
      if (path.startsWith("/admin")) {
        if (!adminEnabled)
          return page(
            "Administration setup",
            '<section class="panel"><h1>Administration is not configured</h1><p>The server operator must set ADMIN_PASSWORD_HASH (recommended) or ADMIN_PASSWORD in the website environment, then restart the website. No default password is provided.</p></section>',
            503,
          );
        const auth = await session(req);
        if (req.method === "GET" && path === "/admin/login") {
          if (auth?.admin === 1) return redirect("/admin");
          const fresh = auth ? null : await newSession(false);
          const csrf = auth?.csrf ?? fresh!.csrf;
          const response = await page(
            "Administrator login",
            `<section class="panel narrow"><h1>Administrator login</h1><form method="post" action="/admin/login">${field(csrf)}<label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label><button type="submit">Log in</button></form></section>`,
          );
          if (fresh) response.headers.set("Set-Cookie", cookie(fresh.raw));
          return response;
        }
        if (req.method === "POST") {
          if (Number(req.headers.get("content-length") || 0) > 100000)
            return page(
              "Request too large",
              "<section class=panel><h1>Request too large</h1></section>",
              413,
            );
          const type = req.headers.get("content-type") || "";
          if (!type.startsWith("application/x-www-form-urlencoded"))
            return page(
              "Invalid request",
              "<section class=panel><h1>Invalid form submission</h1></section>",
              415,
            );
          const text = await req.text();
          if (text.length > 100000)
            return page(
              "Request too large",
              "<section class=panel><h1>Request too large</h1></section>",
              413,
            );
          const form = new URLSearchParams(text);
          const expected = config.siteOrigin
            ? new URL(config.siteOrigin).origin
            : url.origin;
          if (
            !auth ||
            req.headers.get("origin") !== expected ||
            form.get("csrf") !== auth.csrf
          )
            return page(
              "Invalid request",
              "<section class=panel><h1>Your form has expired</h1><p>Reload the page and try again.</p></section>",
              403,
            );
          if (path === "/admin/login") {
            if (!(await store.loginAttempt(digest(ip))))
              return page(
                "Too many attempts",
                "<section class=panel><h1>Too many login attempts</h1><p>Please wait 15 minutes before trying again.</p></section>",
                429,
              );
            let valid = false;
            try {
              valid = await Bun.password.verify(
                form.get("password") || "",
                passwordHash,
              );
            } catch {}
            if (!valid)
              return page(
                "Login failed",
                '<section class="panel"><h1>Login failed</h1><p>The password was not accepted.</p><a href="/admin/login">Try again</a></section>',
                401,
              );
            await store.sql`DELETE FROM sessions WHERE id=${auth.id}`;
            const fresh = await newSession(true);
            return redirect("/admin", cookie(fresh.raw));
          }
          if (auth.admin !== 1) return redirect("/admin/login");
          if (path === "/admin/logout") {
            await store.sql`DELETE FROM sessions WHERE id=${auth.id}`;
            return redirect("/admin/login", cookie("", 0));
          }
          if (path === '/admin/preview') {
            const body = form.get('body') ?? '', format = form.get('format') ?? 'markdown';
            if (body.length > 30000 || !['plain','markdown'].includes(format)) return Response.json({error:'Invalid preview'},{status:400});
            return Response.json({html:renderContent(body,format as ContentFormat)},{headers:{'Cache-Control':'no-store'}});
          }
          if (/^\/admin\/announcements(?:\/[^/]+)?$/.test(path)) {
            const id = path.split("/")[3];
            try {
              await store.save({
                id,
                title: form.get("title") || "",
                body: form.get("body") || "",
                state: form.get("state") || "",
                kind: form.get('kind') ?? undefined, format: form.get('format') ?? undefined,
                author: form.get('author') ?? undefined, category: form.get('category') ?? undefined,
                project: form.get('project') ?? undefined, tags: form.get('tags') ?? undefined, summary: form.get('summary') ?? undefined,
              });
              return redirect("/admin");
            } catch (error) {
              const row = id ? await store.get(id, true) : undefined;
              return page(
                "Cannot save announcement",
                editor(
                  auth.csrf,
                  row,
                  error instanceof ValidationError
                    ? error.message
                    : "Unable to save. Please try again.",
                  Object.fromEntries(['title','body','kind','format','author','category','project','tags','summary','state'].map(key=>[key,form.get(key)??''])) as Partial<import('./store').Announcement>,
                ),
                400,
              );
            }
          }
        }
        if (!auth || auth.admin !== 1) return redirect("/admin/login");
        if (req.method === "GET" && path === "/admin")
          return page(
            "Announcements",
            `<section class="panel"><div class="section-heading"><h1>News and developer posts</h1><p><a href="/forums">Visit and moderate the forums</a></p><form method="post" action="/admin/logout">${field(auth.csrf)}<button type="submit">Log out</button></form></div><p><a class="gold-button" href="/admin/announcements/new">Create post</a></p>${(await store.list(true)).map((row) => `<article class="admin-row"><a href="/admin/announcements/${escape(row.id)}">${escape(row.title)}</a><span class="badge">${escape(row.kind)} · ${escape(row.state)}</span><small>Updated ${date(row.updated_at)}</small></article>`).join("") || "<p>No announcements yet. Create your first update.</p>"}</section>`,
          );
        if (req.method === "GET" && path === "/admin/announcements/new")
          return page("Create announcement", editor(auth.csrf));
        if (
          req.method === "GET" &&
          /^\/admin\/announcements\/[^/]+$/.test(path)
        ) {
          const row = await store.get(path.split("/")[3]!, true);
          if (row) return page("Edit announcement", editor(auth.csrf, row));
        }
      }
      return page(
        "Not found",
        '<section class="panel"><h1>Page not found</h1><p>That page is not available.</p><a href="/">Return home</a></section>',
        404,
      );
    } catch (error) {
      console.error(
        "Request failed:",
        error instanceof Error ? error.message : "Unknown error",
      );
      return path === "/readyz"
        ? Response.json({ status: "unavailable" }, { status: 503 })
        : page(
            "Temporarily unavailable",
            '<section class="panel"><h1>Temporarily unavailable</h1><p>Please try again shortly.</p></section>',
            503,
          );
    }
  }
  return { handle, store, close: () => store.close() };
}
