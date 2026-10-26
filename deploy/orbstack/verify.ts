import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const namespace = "2010scape-test";
const origin = "http://2010scape-web.2010scape-test.svc.cluster.local";
const credentials = JSON.parse(await readFile(resolve(import.meta.dir, "../../local/deploy/orbstack/credentials.json"), "utf8"));
async function kube(args: string[], input?: string) {
  const proc = Bun.spawn(["kubectl", "--context", "orbstack", "-n", namespace, ...args], {
    stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code) throw new Error(`kubectl ${args[0]} failed: ${stderr}`);
  return stdout;
}
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
  console.log("PASS", label);
}
const ns = JSON.parse(await kube(["get", "namespace", namespace, "-o", "json"]));
check(ns.metadata.labels["2010scape.dev/local-test"] === "true", "isolated local test namespace");
let cookie = "";
async function request(path: string, form?: Record<string, string>, overrideCookie?: string) {
  // One local web pod is deliberately replaced by this test. Retry only reads
  // while OrbStack's native Service route drops/drains old TCP connections.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(origin + path, { redirect: "manual", keepalive: false,
        method: form ? "POST" : "GET", headers: {
          Connection: "close",
          ...(cookie || overrideCookie ? { Cookie: overrideCookie ?? cookie } : {}),
          ...(form ? { "Content-Type": "application/x-www-form-urlencoded", Origin: origin } : {}),
        }, body: form ? new URLSearchParams(form) : undefined,
        signal: AbortSignal.timeout(form ? 10000 : 3000),
      });
      if (!form && response.status >= 500 && attempt < 9) {
        await response.text();
        console.log(`Retrying GET ${path} while local Service recovers (${attempt + 1})`);
        await Bun.sleep(500);
        continue;
      }
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0]!;
      return response;
    } catch (error) {
      if (form || attempt >= 9) throw error;
      console.log(`Retrying GET ${path} after local pod connection replacement (${attempt + 1})`);
      await Bun.sleep(500);
    }
  }
}
const csrf = (html: string) => html.match(/name="csrf" value="([^"]+)"/)?.[1] ?? "";
const title = "Local deployment verification " + crypto.randomUUID();
let id: string | undefined;
let databaseStopped = false;
try {
  for (const path of ["/healthz", "/readyz", "/", "/archive/www.runescape.com/css/global-34.css", "/archive/www.runescape.com/img/main/home/bannerLogoc4ca.jpg", "/archive/www.runescape.com/kbase/guid/manual.html"]) {
    const response = await request(path);
    check(response.status === 200, `${path} returns 200`);
    if (path === "/") check((await response.text()).includes('id="bannerLogo"'), "original archived homepage rendered");
  }
  const login = await request("/admin/login");
  const loginToken = csrf(await login.text());
  check(!!loginToken, "login CSRF token available");
  check((await request("/admin/login", { csrf: "invalid", password: "unused" })).status === 403, "CSRF rejection");
  check((await request("/admin/login", { csrf: loginToken, password: credentials.adminPassword })).status === 303, "administrator login");
  let admin = await request("/admin");
  let token = csrf(await admin.text());
  for (let probe = 0; probe < 32; probe++) {
    const ready = await request("/readyz");
    if (ready.status !== 200) throw new Error("Repeated readiness probe failed");
    await ready.text();
    const page = await request("/admin");
    if (page.status !== 200) throw new Error("Authenticated read stalled after readiness probe");
    await page.text();
  }
  check(true, "32 readiness probes interleaved with authenticated requests");
  const input = { csrf: token, title, body: "Private deployment test <script>window.invalid=true</script>", state: "draft" };
  check((await request("/admin/announcements", input)).status === 303, "draft creation");
  const list = await (await request("/admin")).text();
  const links = [...list.matchAll(/href="\/admin\/announcements\/([a-f0-9-]{36})"[^>]*>([^<]*)</g)];
  id = links.find((match) => match[2] === title)?.[1];
  check(!!id, "created announcement identified");
  check((await request("/news/" + id)).status === 404, "draft is private");
  check((await request("/admin/announcements/" + id, { ...input, state: "published" })).status === 303, "publish announcement");
  const published = await request("/news/" + id);
  check(published.status === 200 && (await published.text()).includes("&lt;script&gt;"), "published content is escaped");
  check((await request("/admin/announcements/" + id, input)).status === 303, "unpublish announcement");
  check((await request("/news/" + id)).status === 404, "unpublished announcement hidden");

  console.log("Replacing website pod...");
  await kube(["delete", "pod", "-l", "app.kubernetes.io/name=2010scape-web", "--wait=false"]);
  await kube(["rollout", "status", "deployment/2010scape-web", "--timeout=55s"]);
  console.log("Website replacement ready; checking saved session...");
  admin = await request("/admin");
  check(admin.status === 200 && (await admin.text()).includes(title), "session and draft survive website pod replacement");

  const pods = JSON.parse(await kube(["get", "pods", "-l", "app.kubernetes.io/name=2010scape-web", "-o", "json"]));
  const webPod = pods.items.find((pod: any) => !pod.metadata.deletionTimestamp && pod.status.phase === "Running");
  const podOrigin = `http://${webPod.status.podIP}:3000`;
  console.log("Stopping only the isolated PostgreSQL StatefulSet for outage check...");
  databaseStopped = true;
  await kube(["scale", "statefulset/2010scape-web-postgres", "--replicas=0"]);
  await kube(["wait", "--for=delete", "pod/2010scape-web-postgres-0", "--timeout=55s"]);
  const before = performance.now();
  const down = await fetch(podOrigin + "/readyz", { signal: AbortSignal.timeout(5000) });
  check(down.status === 503 && performance.now() - before < 3000, "database outage readiness returns 503 within deadline");
  check((await fetch(podOrigin + "/healthz")).status === 200, "liveness remains healthy during database outage");
  await kube(["wait", "--for=condition=Ready=false", `pod/${webPod.metadata.name}`, "--timeout=35s"]);
  check(true, "Kubernetes readiness removes unavailable web pod");
  await kube(["scale", "statefulset/2010scape-web-postgres", "--replicas=1"]);
  databaseStopped = false;
  await kube(["rollout", "status", "statefulset/2010scape-web-postgres", "--timeout=55s"]);
  await kube(["wait", "--for=condition=Ready", `pod/${webPod.metadata.name}`, "--timeout=55s"]);
  check((await request("/readyz")).status === 200, "website readiness recovers after database restart");
  admin = await request("/admin");
  const recovered = await admin.text();
  check(admin.status === 200 && recovered.includes(title), "session and draft survive PostgreSQL pod replacement on PVC");
  token = csrf(recovered);
  check((await request("/admin/logout", { csrf: token })).status === 303, "administrator logout");
} finally {
  if (databaseStopped) {
    await kube(["scale", "statefulset/2010scape-web-postgres", "--replicas=1"]);
    await kube(["rollout", "status", "statefulset/2010scape-web-postgres", "--timeout=55s"]);
  }
  if (id && /^[a-f0-9-]{36}$/.test(id)) {
    await kube(["exec", "-i", "2010scape-web-postgres-0", "--", "psql", "-U", "2010scape", "-d", "2010scape_web", "-v", "ON_ERROR_STOP=1"], `DELETE FROM announcements WHERE id = '${id}';\n`);
    console.log("PASS temporary announcement removed");
  }
}
console.log("OrbStack website verification complete; deployment remains running.");
