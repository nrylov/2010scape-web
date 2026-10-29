# Local OrbStack website deployment

This workflow targets **only** the local `orbstack` context and dedicated `2010scape-test` namespace. It deploys one website pod, PostgreSQL 17 with a 2 GiB persistent claim, and a read-only mount of the actual original website. It does not change existing namespaces, install ingress controllers, publish images, or deploy a game world.

Prerequisites: OrbStack Kubernetes running with its default `local-path` storage class, Docker, kubectl, Bun, and the full archive extracted under `local/website-reference/2010-07-18/`. A different extracted date root can be supplied through `WEBSITE_ARCHIVE_ROOT`.

From the repository root:

```sh
docker build -t 2010scape-web:orbstack-dev .
WEB_IMAGE=2010scape-web:orbstack-dev bun deploy/orbstack/render.ts
kubectl --context orbstack apply -f local/deploy/orbstack/resources.json
kubectl --context orbstack -n 2010scape-test rollout status statefulset/2010scape-web-postgres
kubectl --context orbstack -n 2010scape-test rollout status deployment/2010scape-web
```

The renderer reuses the generic website manifests, reducing the web replica count to one, adding PostgreSQL and waiting for its TCP readiness before application startup. It writes the resolved host path and randomly generated credentials **only** to ignored `local/deploy/orbstack/`. That directory has mode 0700, and its credential and manifest files have mode 0600. Re-rendering preserves existing credentials, which is necessary when reusing the PostgreSQL PVC.

The local image uses `imagePullPolicy: Never`; OrbStack shares Docker images with Kubernetes. When rebuilding an existing image tag, explicitly restart the website Deployment after the build. Unique image tags make updates clearer.

Open:

```text
http://2010scape-web.2010scape-test.svc.cluster.local
```

OrbStack makes ClusterIP Service DNS reachable directly from macOS, so no port-forward process or public Ingress is needed. `SITE_ORIGIN` matches that exact URL. Cookies use local HTTP settings; production deployments must use HTTPS and secure cookies.

For `/admin`, open the ignored `local/deploy/orbstack/credentials.json` file yourself and use its `adminPassword` value. Passwords are not printed by the renderer. The cluster Secret contains the database password and administrator password hash. Never commit generated manifests or credentials.

The website uses `http://2010scape-game:43595/status` for game status by default. It reports unknown while that separate game Service does not exist. Set `GAME_STATUS_URL` when rendering to choose another internal endpoint.

## Verification

```sh
bun deploy/orbstack/verify.ts
```

This is an active local integration test. It authenticates, verifies CSRF and draft visibility, temporarily publishes then unpublishes a uniquely named announcement, replaces the website pod, and scales **only this namespace's website PostgreSQL StatefulSet** down and up. It checks session/content persistence, readiness failure and recovery, and liveness independence. It removes its temporary announcement and leaves both workloads running. Do not use this verification script against a production workload.

The namespace ownership label is checked before mutations. Game pods and unrelated namespace workloads are never targeted. Replacing a single website pod can briefly interrupt native Service connections; the verifier disables connection reuse and retries reads while routing recovers. It never retries writes automatically.

## Persistence and lifecycle

The web pod is stateless; PostgreSQL data lives on `data-2010scape-web-postgres-0`. Replacing either pod preserves announcements and sessions. Keep the local credentials file when reusing this database. The original archive remains mounted read-only and outside the image.

To stop the test workloads without deleting their persistent data, scale the two named workloads to zero. To remove the entire namespace and its dynamically provisioned database volume, delete `2010scape-test` only after accepting that data loss. Namespace deletion may also remove a separately deployed test game world, so inspect its resources first.

This hostPath setup is intentionally for a single-node local OrbStack cluster. Use appropriately provisioned read-only shared storage, external PostgreSQL, image releases, TLS and managed secrets for a production deployment.

Validation on OrbStack: original homepage, guide, CSS and images returned HTTP200; authentication, CSRF, draft/publication controls, 32 readiness probes interleaved with authenticated reads, web-pod replacement, PostgreSQL outage and PVC-backed recovery all passed. No temporary announcements remain. The deployed website also reported the separately deployed game Service online.

Current website milestone: `2010scape-web:website-20261028-2` (2026-10-28). Publishing/forum persistence verification passed, along with GE/hiscores public-route checks. Only the website/PostgreSQL test pods were replaced; the game world was untouched. GE and hiscores show labeled contrived data. Player authentication remains deferred.

Native-page/mobile milestone: `2010scape-web:website-20261028-4`. Captured content now uses native site routes, legacy URLs redirect, and responsive checks cover the main page families. See `docs/native-pages-and-mobile.md`.
