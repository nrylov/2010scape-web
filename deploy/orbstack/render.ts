import { mkdir, readFile, writeFile, chmod, access } from "node:fs/promises";
import { resolve } from "node:path";

// Local OrbStack deployment only. Generated manifests contain credentials and
// machine paths, so they are written exclusively under ignored local/.
const root = resolve(import.meta.dir, "../..");
const output = resolve(root, "local/deploy/orbstack");
const archive = resolve(root, process.env.WEBSITE_ARCHIVE_ROOT || "local/website-reference/2010-07-18");
const namespace = "2010scape-test";
const origin = "http://2010scape-web.2010scape-test.svc.cluster.local";
const image = process.env.WEB_IMAGE || "2010scape-web:orbstack-dev";
await access(resolve(archive, "www.runescape.com/index.html"));
await mkdir(output, { recursive: true, mode: 0o700 });
await chmod(output, 0o700);
const credentialsPath = resolve(output, "credentials.json");
let credentials: { adminPassword: string; adminHash: string; databasePassword: string };
try {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const random = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex");
  const adminPassword = random();
  credentials = { adminPassword, adminHash: await Bun.password.hash(adminPassword), databasePassword: random() };
  await writeFile(credentialsPath, JSON.stringify(credentials, null, 2) + "\n", { mode: 0o600 });
}
await chmod(credentialsPath, 0o600);
async function command(args: string[], input?: string) {
  const proc = Bun.spawn(args, { cwd: root, stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code) throw new Error(`${args[0]} failed: ${stderr}`);
  return stdout;
}
const rendered = await command(["kubectl", "kustomize", "deploy/kubernetes"]);
const converted = await command(["kubectl", "--context", "orbstack", "create", "--dry-run=client", "--validate=false", "-f", "-", "-o", "json"], rendered);
// kubectl prints each top-level resource as a separate pretty JSON object.
const resources = converted.trim().split(/\n(?=\{)/).flatMap((value) => {
  const resource = JSON.parse(value);
  return resource.kind === "List" ? resource.items : [resource];
}) as any[];
for (const resource of resources) {
  if (resource.kind === "Namespace") {
    resource.metadata.name = namespace;
    resource.metadata.labels = { "app.kubernetes.io/part-of": "2010scape", "2010scape.dev/local-test": "true" };
  } else resource.metadata.namespace = namespace;
  if (resource.kind === "ConfigMap") Object.assign(resource.data, {
    SITE_ORIGIN: origin, SESSION_COOKIE_SECURE: "false", WEBSITE_ARCHIVE_ROOT: "/srv/website-reference",
    GAME_STATUS_URL: process.env.GAME_STATUS_URL || "http://2010scape-game:43595/status",
    GAME_MARKET_URL: process.env.GAME_MARKET_URL || "http://2010scape-game:43595",
  });
  if (resource.kind === "Deployment") {
    resource.spec.replicas = 1;
    const pod = resource.spec.template.spec;
    pod.initContainers = [{ name: "wait-for-postgres", image: "postgres:17-alpine", imagePullPolicy: "IfNotPresent",
      command: ["sh", "-c", "until pg_isready -h 2010scape-web-postgres -U 2010scape -d 2010scape_web; do sleep 1; done"],
      securityContext: { runAsNonRoot: true, runAsUser: 70, runAsGroup: 70, readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
      resources: { requests: { cpu: "10m", memory: "16Mi" }, limits: { cpu: "100m", memory: "64Mi" } },
    }];
    pod.containers[0].image = image;
    pod.containers[0].imagePullPolicy = "Never";
    pod.containers[0].volumeMounts.push({ name: "website-reference", mountPath: "/srv/website-reference", readOnly: true });
    pod.volumes.push({ name: "website-reference", hostPath: { path: archive, type: "Directory" } });
  }
}
const meta = (name: string) => ({ name, namespace, labels: { "app.kubernetes.io/part-of": "2010scape" } });
resources.push({ apiVersion: "v1", kind: "Secret", metadata: meta("2010scape-web-secrets"), type: "Opaque", stringData: {
  DATABASE_URL: `postgres://2010scape:${credentials.databasePassword}@2010scape-web-postgres:5432/2010scape_web`,
  POSTGRES_PASSWORD: credentials.databasePassword, ADMIN_PASSWORD_HASH: credentials.adminHash,
} });
resources.push({ apiVersion: "v1", kind: "Service", metadata: meta("2010scape-web-postgres"), spec: {
  clusterIP: "None", selector: { "app.kubernetes.io/name": "2010scape-web-postgres" }, ports: [{ name: "postgres", port: 5432, targetPort: "postgres" }],
} });
resources.push({ apiVersion: "apps/v1", kind: "StatefulSet", metadata: meta("2010scape-web-postgres"), spec: {
  serviceName: "2010scape-web-postgres", replicas: 1,
  selector: { matchLabels: { "app.kubernetes.io/name": "2010scape-web-postgres" } },
  template: { metadata: { labels: { "app.kubernetes.io/name": "2010scape-web-postgres" } }, spec: {
    automountServiceAccountToken: false, terminationGracePeriodSeconds: 30,
    securityContext: { runAsNonRoot: true, runAsUser: 70, runAsGroup: 70, fsGroup: 70, seccompProfile: { type: "RuntimeDefault" } },
    containers: [{ name: "postgres", image: "postgres:17-alpine", imagePullPolicy: "IfNotPresent", ports: [{ name: "postgres", containerPort: 5432 }],
      env: [{ name: "POSTGRES_DB", value: "2010scape_web" }, { name: "POSTGRES_USER", value: "2010scape" }, { name: "PGDATA", value: "/var/lib/postgresql/data/pgdata" },
        { name: "POSTGRES_PASSWORD", valueFrom: { secretKeyRef: { name: "2010scape-web-secrets", key: "POSTGRES_PASSWORD" } } }],
      startupProbe: { exec: { command: ["pg_isready", "-h", "127.0.0.1", "-U", "2010scape", "-d", "2010scape_web"] }, periodSeconds: 2, failureThreshold: 30 },
      readinessProbe: { exec: { command: ["pg_isready", "-h", "127.0.0.1", "-U", "2010scape", "-d", "2010scape_web"] }, periodSeconds: 5, timeoutSeconds: 3 },
      livenessProbe: { exec: { command: ["pg_isready", "-h", "127.0.0.1", "-U", "2010scape", "-d", "2010scape_web"] }, periodSeconds: 15, timeoutSeconds: 3 },
      resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1", memory: "512Mi" } },
      securityContext: { readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
      volumeMounts: [{ name: "data", mountPath: "/var/lib/postgresql/data" }, { name: "socket", mountPath: "/var/run/postgresql" }, { name: "temporary", mountPath: "/tmp" }],
    }], volumes: [{ name: "socket", emptyDir: { sizeLimit: "16Mi" } }, { name: "temporary", emptyDir: { sizeLimit: "32Mi" } }],
  } },
  volumeClaimTemplates: [{ metadata: { name: "data" }, spec: { accessModes: ["ReadWriteOnce"], storageClassName: "local-path", resources: { requests: { storage: "2Gi" } } } }],
} });
const manifestPath = resolve(output, "resources.json");
await writeFile(manifestPath, JSON.stringify({ apiVersion: "v1", kind: "List", items: resources }, null, 2) + "\n", { mode: 0o600 });
await chmod(manifestPath, 0o600);
console.log(`Rendered ${resources.length} local resources for namespace ${namespace}.`);
console.log(`Manifest: ${manifestPath}`);
console.log(`Private administrator credentials: ${credentialsPath}`);
console.log(`Website URL: ${origin}`);
console.log(`Image: ${image}`);
