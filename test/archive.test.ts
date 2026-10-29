import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ArchiveSite } from "../src/archive";
import { createApp } from "../src/app";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp("/private/tmp/2010scape-archive-test-");
  directories.push(root);
  const host = join(root, "www.runescape.com");
  await mkdir(join(host, "css"), { recursive: true });
  await mkdir(join(host, "img"), { recursive: true });
  await mkdir(join(host, "guide"), { recursive: true });
  await mkdir(join(root, "services.runescape.com", "m=news"), {
    recursive: true,
  });
  const html = `<!doctype html><html><head><title>Historical title</title><base href="https://evil.invalid/"><meta http-equiv="refresh" content="0;url=https://evil.invalid"><style>@import url(css/global.css);</style><script src="https://evil.invalid/track.js"></script></head><body class="bodyBackground" onload="evil()" onclick="evil()"><a id="home" href="title.html">Home</a><a id="play" href="game.html">Play</a><a id="login" href="../secure.runescape.com/m%3dweblogin/login.html">Login</a><a id="community" href="../services.runescape.com/m%3dforum/index.html"><span class="ts">Community</span></a><div id="banner"><img src="img/banner.jpg" onerror="evil()"></div><div id="content"><div id="players">104,681 people online</div><div id="recentnews"><div class="sectionHeader">Original header</div><div class="section"><p>Old news</p></div></div><a class="guide" href="guide/page.html">Guide</a><a class="cross" href="../services.runescape.com/m%3dnews/story.html">Story</a><a class="absolute" href="https://www.runescape.com/guide/page.html">Absolute</a><a class="external" href="https://evil.invalid/">External</a><a class="evil" href="jav&#x61;script:alert(1)">Bad</a><img class="tracker" src="https://tracker.invalid/pixel.gif"><form action="http://www.runescape.com/search"><input name="q"><button>Search</button></form><iframe src="https://evil.invalid"></iframe><object data="evil.jar"></object><applet code="Game"></applet></div><div id="footer">Original footer</div></body></html>`;
  await writeFile(join(host, "index.html"), html, "latin1");
  await writeFile(
    join(host, "img/banner.jpg"),
    new Uint8Array([0xff, 0xd8, 0xff]),
  );
  await writeFile(
    join(host, "guide/page.html"),
    '<html><head><title>Guide</title></head><body><a href="../index.html">Home</a><p>Historical guide</p><script>alert(1)</script></body></html>',
    "latin1",
  );
  await writeFile(
    join(host, "css/global.css"),
    `a{background:url('../img/banner.jpg')}b{background:url(https://tracker.invalid/pixel.gif)}@import "../css/extra.css";c{background:url('https://services.runescape.com/m%3dnews/picture.png')}`,
  );
  await writeFile(
    join(root, "services.runescape.com/m=news/story.html"),
    "<html><head></head><body>Cross-host news</body></html>",
  );
  return { root, host, site: (await ArchiveSite.load(root))! };
}
const request = (path: string, method = "GET") =>
  new Request("http://localhost" + path, { method });
describe("archived website adapter", () => {
  test("the application serves original archive HTML with published news, local guide/assets and safe live admin forms", async () => {
    const { root } = await fixture();
    const app = await createApp({
      databaseUrl: ":memory:",
      archiveRoot: root,
      adminPassword: "Fixture administrator password",
    });
    try {
      const published = await app.store.save({
        title: "Current published update",
        body: "Current announcement body",
        state: "published",
      });
      const draft = await app.store.save({
        title: "Private unpublished draft",
        body: "Secret draft body",
        state: "draft",
      });
      const response = await app.handle(request("/"));
      expect(response.status).toBe(200);
      const home = await response.text();
      expect(home).toContain('id="banner"');
      expect(home).toContain("Original header");
      expect(home).toContain("Original footer");
      expect(home).toContain("Current published update");
      expect(home).toContain("Current announcement body");
      expect(home).toContain(`/news/${published}`);
      expect(home).not.toContain("Private unpublished draft");
      expect(home).not.toContain("Secret draft body");
      expect(home).not.toContain("Old news");
      expect(home).not.toContain("104,681");
      expect(home).toContain("Game status: Unknown");
      expect(home).toContain("/assets/site/css/global.css");
      expect(home).toContain("/assets/site/img/banner.jpg");
      const csp = response.headers.get("Content-Security-Policy")!;
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).not.toContain("script-src 'unsafe-inline'");
      const news = await app.handle(request("/news"));
      const newsBody = await news.text();
      expect(newsBody).toContain("site-app-content");
      expect(newsBody).toContain("Original footer");
      expect(newsBody).toContain("Current published update");
      expect(newsBody).not.toContain("Private unpublished draft");
      expect((await app.handle(request("/news/" + draft))).status).toBe(404);
      expect((await app.handle(request("/news/" + published))).status).toBe(
        200,
      );
      const guide = await app.handle(
        request("/guide/page"),
      );
      expect(guide.status).toBe(200);
      expect(await guide.text()).toContain("Historical guide");
      expect(guide.headers.get("Content-Security-Policy")).toContain(
        "form-action 'none'",
      );
      const archivedNews = await app.handle(
        request("/news/history/story"),
      );
      expect(archivedNews.status).toBe(200);
      expect(await archivedNews.text()).toContain("Cross-host news");
      const css = await app.handle(
        request("/assets/site/css/global.css"),
      );
      expect(css.status).toBe(200);
      expect(css.headers.get("Content-Type")).toContain("text/css");
      expect(await css.text()).toContain(
        "/assets/site/img/banner.jpg",
      );
      const image = await app.handle(
        request("/assets/site/img/banner.jpg"),
      );
      expect(image.status).toBe(200);
      expect((await image.arrayBuffer()).byteLength).toBe(3);
      expect((await app.handle(request("/site-overrides.css"))).status).toBe(
        200,
      );
      const login = await app.handle(request("/admin/login"));
      const loginBody = await login.text();
      expect(login.status).toBe(200);
      expect(loginBody).toContain("site-app-page");
      expect(loginBody).toContain('action="/admin/login"');
      expect(loginBody).not.toContain("data-archive-disabled");
      const csrf = loginBody.match(/name="csrf" value="([^"]+)"/)![1]!;
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      const signedIn = await app.handle(
        new Request("http://localhost/admin/login", {
          method: "POST",
          headers: {
            cookie,
            origin: "http://localhost",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            csrf,
            password: "Fixture administrator password",
          }),
        }),
      );
      expect(signedIn.status).toBe(303);
      expect(signedIn.headers.get("Location")).toBe("/admin");
    } finally {
      await app.close();
    }
  });
  test("application fallback uses an explicitly missing fixture root independently of local private assets", async () => {
    const { root } = await fixture();
    const app = await createApp({
      databaseUrl: ":memory:",
      archiveRoot: join(root, "missing-archive"),
    });
    try {
      const response = await app.handle(request("/"));
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain("original website files are needed");
      expect(body).toContain("WEBSITE_ARCHIVE_ROOT");
      expect(body).not.toContain('id="banner"');
      expect(
        (await app.handle(request("/archive/www.runescape.com/index.html")))
          .status,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });

  test("uses original shell and news header while substituting current news/status and app routes", async () => {
    const { site } = await fixture();
    const home = await site.renderHome(
      '<div class="sectionBody">Current announcement</div>',
      '<a href="/status">Unknown</a>',
    );
    expect(home).toContain("Original header");
    expect(home).toContain("Original footer");
    expect(home).toContain("Current announcement");
    expect(home).not.toContain("Old news");
    expect(home).not.toContain("104,681");
    expect(home).toContain('href="/status"');
    expect(home).toContain('href="/play"');
    expect(home).toContain('href="/admin"');
    expect(home).toContain('href="/forums"');
    expect(home).toContain('<span class="ts">Community</span>');
    expect(home).not.toContain('<span class="ts">News</span>');
    expect(home).toContain('href="/guide/page"');
    expect(home).toContain(
      'href="/news/history/story"',
    );
    expect(home).toContain("/site-overrides.css");
    expect(home).toContain("/assets/site/css/global.css");
    expect(await site.renderHome("No news")).toContain(
      "Game world status is not configured",
    );
  });
  test("strips historical active content and tracking, disables forms, and keeps app forms functional", async () => {
    const { site } = await fixture();
    const home = await site.renderHome("Current");
    for (const unsafe of [
      "<script",
      "<iframe",
      "<object",
      "<applet",
      "<base",
      "onload=",
      "onclick=",
      "onerror=",
      "javascript:",
      "tracker.invalid",
      "evil.invalid",
      'http-equiv="refresh"',
    ])
      expect(home.toLowerCase()).not.toContain(unsafe);
    expect(home).toContain('data-archive-disabled="true"');
    expect(home).toContain("disabled");
    const page = await site.renderPage(
      "<Admin>",
      '<form method="post" action="/admin/login"><input name="password"></form>',
    );
    expect(page).toContain("&lt;Admin&gt; - 2010scape");
    expect(page).toContain("site-app-page");
    expect(page).toContain("site-app-content");
    expect(page).toContain('action="/admin/login"');
    expect(page).toContain('<input name="password">');
    expect(page).not.toContain("Old news");
  });
  test("serves integrated pages and rewrites CSS and cross-host assets", async () => {
    const { site } = await fixture();
    const css = await site.serve(
      request("/assets/site/css/global.css"),
    );
    expect(css?.status).toBe(200);
    const text = await css!.text();
    expect(text).toContain("/assets/site/img/banner.jpg");
    expect(text).toContain("/assets/site/css/extra.css");
    expect(text).toContain(
      "/assets/services/m%3Dnews/picture.png",
    );
    expect(text).not.toContain("tracker.invalid");
    const home = await site.serve(request("/archive/www.runescape.com/"));
    expect(home?.status).toBe(308);
    expect(home!.headers.get('location')).toBe('/');
    const cross = await site.serve(
      request("/news/history/story"),
    );
    expect(cross?.status).toBe(200);
    expect(await cross!.text()).toContain("Cross-host news");
    const guide = await site.serve(
      request("/guide/page"),
    );
    expect(await guide!.text()).toContain(
      'href="/"',
    );
    expect(
      (
        await site.serve(
          request("/assets/site/img/banner.jpg", "HEAD"),
        )
      )?.body,
    ).toBeNull();
    expect(await site.serve(request("/other"))).toBeUndefined();
  });
  test("blocks traversal, symlink escape, non-archive hosts and sensitive or executable files", async () => {
    const { site, host } = await fixture();
    const secret = await mkdtemp("/private/tmp/2010scape-archive-secret-");
    directories.push(secret);
    await writeFile(join(secret, "secret.html"), "Secret");
    await symlink(join(secret, "secret.html"), join(host, "escape.html"));
    await writeFile(join(host, "cookies.txt"), "secret");
    await writeFile(join(host, "config.html"), "secret");
    await writeFile(join(host, "client.jar"), "secret");
    await writeFile(join(host, "script.js"), "secret");
    for (const path of [
      "/archive/evil.invalid/index.html",
      "/archive/www.runescape.com/%2e%2e%2fsecret.html",
      "/archive/www.runescape.com/%252e%252e/secret.html",
      "/archive/www.runescape.com/escape.html",
      "/archive/www.runescape.com/cookies.txt",
      "/archive/www.runescape.com/config.html",
      "/archive/www.runescape.com/client.jar",
      "/archive/www.runescape.com/script.js",
      "/archive/www.runescape.com/%00.html",
    ])
      expect((await site.serve(request(path)))?.status).toBe(404);
    expect(
      (
        await site.serve(
          request("/archive/www.runescape.com/index.html", "POST"),
        )
      )?.status,
    ).toBe(405);
  });
  test("decodes the archived Latin-1 document and reports missing archives without fabrication", async () => {
    const { root, host } = await fixture();
    await writeFile(
      join(host, "index.html"),
      '<html><head></head><body><div id="recentnews"><div class="section">News</div></div><p>Caf\xe9</p></body></html>',
      "latin1",
    );
    const site = (await ArchiveSite.load(root))!;
    expect(await site.renderHome("Current")).toContain("Café");
    expect(await ArchiveSite.load(join(root, "not-found"))).toBeUndefined();
  });
  test("loads the real extracted archive when present, preserving its real banner and original stylesheet", async () => {
    const root = resolve(
      import.meta.dir,
      "../local/website-reference/2010-07-18",
    );
    const site = await ArchiveSite.load(root);
    if (!site) return;
    const html = await site.renderHome(
      '<div class="sectionBody">Current local update</div>',
    );
    expect(html).toContain('id="bannerLogo"');
    expect(html).toContain('id="recentnews"');
    expect(html).toContain("/assets/site/css/global-34.css");
    expect(html).toContain("Current local update");
    expect(html).not.toContain("104,681");
    expect(html).not.toContain("<script");
    const css = await site.serve(
      request("/assets/site/css/global-34.css"),
    );
    expect(css?.status).toBe(200);
    expect(await css!.text()).toContain("/assets/site/img/main/");
    const image = await site.serve(
      request("/assets/site/img/main/home/bannerLogoc4ca.jpg"),
    );
    expect(image?.status).toBe(200);
    expect((await image!.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
});

test('native pages and assets replace source-domain URLs while legacy bookmarks redirect',async()=>{
 const {root,host}=await fixture();
 await mkdir(join(host,'kbase/guid'),{recursive:true});
 await writeFile(join(host,'kbase/guid/Downloads_and_Wallpapers.html'),'<html><head><style>.art{background:url(../../img/banner.jpg)}</style></head><body><a href="manual.html#start">Guide</a><img src="../../img/banner.jpg"></body></html>');
 await writeFile(join(host,'kbase/guid/manual.html'),'<html><body>Game guide</body></html>');
 await writeFile(join(host,'kbase/guid/Foo_Bar.html'),'<html><body>Underscore guide</body></html>');
 await writeFile(join(host,'kbase/guid/Foo-Bar.html'),'<html><body>Hyphen guide</body></html>');
 await mkdir(join(root,'www.jagex.com/terms'),{recursive:true});
 await writeFile(join(root,'www.jagex.com/terms/terms.html'),'<html><body>Original terms</body></html>');
 await mkdir(join(host,'l=2/kbase/guid'),{recursive:true});
 await writeFile(join(host,'l=2/kbase/guid/Example.html'),'<html><body>French guide</body></html>');
 const site=(await ArchiveSite.load(root))!;
 expect((await site.serve(request('/terms')))!.status).toBe(200);
 expect((await site.serve(request('/archive/www.runescape.com/terms/terms.html')))!.headers.get('location')).toBe('/terms');
 expect(await(await site.serve(request('/fr/guide/example')))!.text()).toContain('French guide');
 const page=await site.serve(request('/downloads-and-wallpapers'));expect(page!.status).toBe(200);const html=await page!.text();
 expect(html).toContain('href="/game-guide#start"');expect(html).toContain('/assets/site/img/banner.jpg');expect(html).not.toContain('/archive/');expect(html).not.toContain('Historical website reference');
 const legacy=await site.serve(request('/archive/www.runescape.com/kbase/guid/Downloads_and_Wallpapers.html?view=all'));expect(legacy!.status).toBe(308);expect(legacy!.headers.get('location')).toBe('/downloads-and-wallpapers?view=all');
 const asset=await site.serve(request('/archive/www.runescape.com/img/banner.jpg'));expect(asset!.status).toBe(308);expect(asset!.headers.get('location')).toBe('/assets/site/img/banner.jpg');
 const collisions=site.nativePages().filter(p=>p.startsWith('/guide/foo-bar'));expect(collisions).toHaveLength(2);
 const bodies=await Promise.all(collisions.map(async p=>(await site.serve(request(p)))!.text()));expect(bodies.some(b=>b.includes('Underscore guide'))).toBe(true);expect(bodies.some(b=>b.includes('Hyphen guide'))).toBe(true);
 for(const route of site.nativePages())expect((await site.serve(request(route)))!.status).toBe(200);
 for(const path of ['/assets/site/%2e%2e%2fsecret.html','/assets/site/config.html','/assets/unknown/img/banner.jpg'])expect((await site.serve(request(path)))!.status).toBe(404);
});
