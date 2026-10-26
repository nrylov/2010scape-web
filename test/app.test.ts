import { afterEach, describe, expect, test } from "bun:test";
import { createApp, type Config } from "../src/app";
import { Store } from "../src/store";
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
async function app(config: Config = {}) {
  const a = await createApp({
    databaseUrl: ":memory:",
    adminPassword: "correct horse testing",
    ...config,
  });
  apps.push(a);
  return a;
}
const csrf = (body: string) => body.match(/name="csrf" value="([^"]+)"/)![1]!;
const request = (
  path: string,
  cookie?: string,
  form?: Record<string, string>,
  origin = "http://localhost",
) =>
  new Request("http://localhost" + path, {
    method: form ? "POST" : "GET",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(form
        ? { "content-type": "application/x-www-form-urlencoded", origin }
        : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
async function login(a: Awaited<ReturnType<typeof createApp>>) {
  const page = await a.handle(request("/admin/login"));
  const token = csrf(await page.text());
  const initial = page.headers.get("set-cookie")!.split(";")[0]!;
  const res = await a.handle(
    request("/admin/login", initial, {
      csrf: token,
      password: "correct horse testing",
    }),
  );
  expect(res.status).toBe(303);
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const admin = await a.handle(request("/admin", cookie));
  return { cookie, csrf: csrf(await admin.text()), initial };
}
describe("website", () => {
  test("readiness bounds an outage, shares and cancels probes, and recovers without affecting liveness", async () => {
    const a = await app();
    const sql = a.store.sql;
    let queries = 0,
      cancellations = 0;
    let rejectQuery!: (error: Error) => void;
    const pending = new Promise((_, reject) => {
      rejectQuery = reject;
    });
    const query = Object.assign(pending, {
      cancel() {
        cancellations++;
        rejectQuery(new Error("Probe cancelled"));
      },
    });
    a.store.sql = (() => {
      queries++;
      return query;
    }) as unknown as typeof sql;
    try {
      const started = performance.now();
      const probes = Array.from({ length: 12 }, () =>
        a.handle(request("/readyz")),
      );
      expect((await a.handle(request("/healthz"))).status).toBe(200);
      expect(queries).toBe(1);
      const responses = await Promise.all(probes);
      expect(performance.now() - started).toBeLessThan(2600);
      expect(responses.every((response) => response.status === 503)).toBe(true);
      expect(await responses[0]!.json()).toEqual({ status: "unavailable" });
      expect(cancellations).toBe(1);
      expect(queries).toBe(1);
      expect((await a.handle(request("/healthz"))).status).toBe(200);
    } finally {
      a.store.sql = sql;
    }
    // Cancellation must settle before a fresh probe uses the recovered database.
    await Promise.resolve();
    expect((await a.handle(request("/readyz"))).status).toBe(200);
  });

  test("a driver that stalls cancellation cannot accumulate readiness queries", async () => {
    const a = await app();
    const sql = a.store.sql;
    let queries = 0;
    let resolveQuery!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveQuery = resolve;
    });
    const query = Object.assign(pending, { cancel() {} });
    a.store.sql = (() => {
      queries++;
      return query;
    }) as unknown as typeof sql;
    try {
      expect(await a.store.ready(20)).toBe(false);
      expect(await a.store.ready(20)).toBe(false);
      expect(await a.store.ready(20)).toBe(false);
      expect(queries).toBe(1);
      resolveQuery();
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      a.store.sql = sql;
    }
    expect(await a.store.ready()).toBe(true);
  });
  test("public pages are usable without credentials, assets, status or downloads", async () => {
    const a = await app({ adminPassword: undefined });
    for (const path of ["/", "/news", "/play", "/status"]) {
      const r = await a.handle(request(path));
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('name="viewport"');
    }
    expect(await (await a.handle(request("/status"))).text()).toContain(
      "Unknown",
    );
    expect(await (await a.handle(request("/play"))).text()).toContain(
      "has not been configured",
    );
    expect((await a.handle(request("/admin"))).status).toBe(503);
    expect((await a.handle(request("/readyz"))).status).toBe(200);
    expect((await a.handle(request("/reference/../../AGENTS.md"))).status).toBe(
      404,
    );
  });
  test("admin login rotates opaque sessions, enforces CSRF and origin, and logout revokes access", async () => {
    const a = await app();
    const logged = await login(a);
    expect(logged.cookie).not.toBe(logged.initial);
    expect(logged.cookie).not.toContain("correct");
    expect((await a.handle(request("/admin", logged.initial))).status).toBe(
      303,
    );
    expect(
      (
        await a.handle(
          request("/admin/announcements", logged.cookie, {
            title: "bad",
            body: "bad",
            state: "published",
            csrf: "wrong",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await a.handle(
          request(
            "/admin/logout",
            logged.cookie,
            { csrf: logged.csrf },
            "http://evil.invalid",
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await a.handle(
          request("/admin/logout", logged.cookie, { csrf: logged.csrf }),
        )
      ).status,
    ).toBe(303);
    expect((await a.handle(request("/admin", logged.cookie))).status).toBe(303);
  });
  test("draft creation, editing, publishing and unpublishing control public visibility and escape HTML", async () => {
    const a = await app();
    const auth = await login(a);
    const input = {
      csrf: auth.csrf,
      title: '<script>alert("title")</script>',
      body: "<img src=x onerror=alert(1)>\nSecond paragraph",
      state: "draft",
    };
    expect(
      (await a.handle(request("/admin/announcements", auth.cookie, input)))
        .status,
    ).toBe(303);
    const rows = await a.store.list(true);
    expect(rows).toHaveLength(1);
    const id = rows[0]!.id;
    expect(await a.store.list()).toHaveLength(0);
    expect((await a.handle(request("/news/" + id))).status).toBe(404);
    expect(await (await a.handle(request("/news"))).text()).not.toContain(
      "Second paragraph",
    );
    expect(
      (
        await a.handle(
          request("/admin/announcements/" + id, auth.cookie, {
            ...input,
            state: "published",
          }),
        )
      ).status,
    ).toBe(303);
    const published = await a.handle(request("/news/" + id));
    expect(published.status).toBe(200);
    const html = await published.text();
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script>");
    expect(await a.store.list()).toHaveLength(1);
    expect(
      (
        await a.handle(
          request("/admin/announcements/" + id, auth.cookie, {
            ...input,
            state: "draft",
          }),
        )
      ).status,
    ).toBe(303);
    expect((await a.handle(request("/news/" + id))).status).toBe(404);
  });
  test("invalid writes do not mutate data and SQL transactions roll back", async () => {
    const a = await app();
    const id = await a.store.save({
      title: "Original",
      body: "Text",
      state: "draft",
    });
    await expect(
      a.store.save({ id, title: "Changed", body: "Text", state: "bogus" }),
    ).rejects.toThrow();
    expect((await a.store.get(id, true))!.title).toBe("Original");
    await expect(
      a.store.sql.begin(async (tx) => {
        await tx`UPDATE announcements SET title='Broken' WHERE id=${id}`;
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect((await a.store.get(id, true))!.title).toBe("Original");
  });
  test("login failures are limited in the shared SQL store and cookies are protected", async () => {
    const a = await app({ secureCookie: true });
    const loginPage = await a.handle(request("/admin/login"));
    expect(loginPage.headers.get("set-cookie")).toContain(
      "HttpOnly; SameSite=Lax",
    );
    expect(loginPage.headers.get("set-cookie")).toContain("Secure");
    const c = loginPage.headers.get("set-cookie")!.split(";")[0]!;
    const token = csrf(await loginPage.text());
    for (let i = 0; i < 10; i++)
      expect(
        (
          await a.handle(
            request("/admin/login", c, { csrf: token, password: "wrong" }),
            "test-ip",
          )
        ).status,
      ).toBe(401);
    expect(
      (
        await a.handle(
          request("/admin/login", c, {
            csrf: token,
            password: "correct horse testing",
          }),
          "test-ip",
        )
      ).status,
    ).toBe(429);
  });
  test("saved announcements survive closing and reopening SQLite", async () => {
    const path = `/tmp/2010scape-web-test-${crypto.randomUUID()}.sqlite`;
    const first = await Store.open("sqlite://" + path);
    const id = await first.save({
      title: "Durable",
      body: "Saved",
      state: "published",
    });
    await first.close();
    const second = await Store.open("sqlite://" + path);
    try {
      expect((await second.get(id))!.title).toBe("Durable");
    } finally {
      await second.close();
      await Bun.file(path).delete();
    }
  });
  test("status endpoint response is explicit and failures stay unknown", async () => {
    const backend = Bun.serve({
      port: 0,
      fetch: () => Response.json({ online: true, players: 12 }),
    });
    try {
      const a = await app({ gameStatusUrl: String(backend.url) });
      expect(await (await a.handle(request("/status"))).text()).toContain(
        "12 players online",
      );
    } finally {
      backend.stop(true);
    }
    const a = await app({ gameStatusUrl: "http://127.0.0.1:1" });
    expect(await (await a.handle(request("/status"))).text()).toContain(
      "Unknown",
    );
  });
});
