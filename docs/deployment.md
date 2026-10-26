# Container and Kubernetes deployment

The website runs on Bun 1.4.3 and uses its built-in HTTP and SQL APIs. The runtime has no package dependencies or separate build step. The Docker image copies only `src/`, `public/` and `package.json`; reference archives, local assets, database files and credentials are excluded from its context.

## Local development

For the normal local SQLite workflow, follow the root README. Docker Compose is a separate PostgreSQL integration setup, not a requirement for editing the website.

The Compose setup starts an internal PostgreSQL 17 service and the website on `http://localhost:3000`. It does not publish the database port. Choose a random URL-safe database password and supply it through your shell or an untracked `.env` file:

```sh
export POSTGRES_PASSWORD='replace-with-a-random-url-safe-password'
docker compose config --quiet
docker compose up --build
```

Use a URL-safe password because Compose constructs a database URL from this value. If you change `WEB_PORT` or use another hostname, set `SITE_ORIGIN` to that exact external origin too. `WEB_BIND_ADDRESS` defaults to `127.0.0.1`; `WEB_PORT` defaults to `3000`.

`ADMIN_PASSWORD_HASH` enables administration with a hash produced by `Bun.password.hash`. `ADMIN_PASSWORD` is a local alternative. There is no built-in administrator password; without either value, administration remains disabled. When placing an Argon hash in a Compose `.env` file, single-quote the value so `$` characters remain literal. Do not commit the `.env` file.

Compose sets `SESSION_COOKIE_SECURE=false` only for local HTTP. Production must use HTTPS and secure cookies. `GAME_STATUS_URL` and `DOWNLOAD_URL` are optional; leaving them empty keeps those integrations unavailable instead of inventing online status or a download.

The `postgres-data` named volume preserves announcements and sessions across container replacement. `docker compose down` keeps it; `docker compose down --volumes` removes the database. Back up the database independently of container images.

## Image behavior

```sh
docker build -t 2010scape-web:local .
```

The process runs as the image's non-root `bun` user (UID 1000), listens on port 3000 and receives `SIGTERM` directly. `/healthz` checks the process; `/readyz` also checks SQL connectivity. Shutdown stops HTTP acceptance before closing the database. Compose provides a 30-second stop grace period.

For a standalone SQLite container, mount persistent storage at `/app/local/data` and set `DATABASE_URL=sqlite:///app/local/data/site.sqlite`. Run one instance against that file. The Kubernetes configuration deliberately uses PostgreSQL, not per-pod SQLite files.

## Original website archive at runtime

The public layout uses the extracted 2010 HTML, CSS and images. Extract the supplied archive locally using the README workflow; the archive and extracted assets stay under ignored `local/` and are never copied into the container image. `WEBSITE_ARCHIVE_ROOT` must name the extracted date directory containing host folders such as `www.runescape.com`, not the host folder itself. Its local default is `local/website-reference/2010-07-18`.

For a standalone container, provide that directory as a read-only bind mount and set its container path:

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  --mount type=bind,src="$PWD/local/website-reference/2010-07-18",dst=/srv/website-reference,readonly \
  -e WEBSITE_ARCHIVE_ROOT=/srv/website-reference \
  -e DATABASE_URL='postgresql://user:password@database-host/site' \
  2010scape-web:local
```

The database URL above is illustrative; pass real credentials through an untracked environment file or secret mechanism. The provided Compose file does not mount the archive automatically. Add a local override with the same read-only bind mount and `WEBSITE_ARCHIVE_ROOT` setting before using the original layout in Compose.

For Kubernetes, supply extracted assets separately on a volume readable by UID 1000. Mount it read-only into every website replica and set `WEBSITE_ARCHIVE_ROOT` to the mount path. Choose storage accessible by every scheduled replica, such as a separately provisioned read-only shared volume; a developer-machine path is suitable only for explicitly local testing. These assets are too large for ConfigMaps and must not be placed in Git, Secrets or the published application image. The generic manifests deliberately do not provision or populate this archive volume; add that environment setting and volume mount to your deployment overlay.

The additive `public/site-overrides.css` keeps original desktop assets/layout and adapts narrow screens. Archive scripts are removed by the server adapter; menu keyboard/touch behavior uses CSS focus rules. Extracted source pages are historical reference material rather than live account or payment services.

## Kubernetes manifests

`deploy/kubernetes/` contains a Kustomize base with a namespace, ConfigMap, two-replica Deployment and ClusterIP Service. It uses an external PostgreSQL database shared by both replicas. Announcements and opaque login sessions are stored in that database.

Before using the manifests:

1. Build and publish the image, then replace `ghcr.io/your-org/2010scape-web:replace-me` with its immutable release tag or digest.
2. Set the real HTTPS origin in `configmap.yaml`.
3. Copy `secret.example.yaml` outside the checkout and replace its database URL and administrator hash with real values. Provision the namespace before creating the real Secret. Use an externally managed PostgreSQL database with TLS and backups.
4. Configure your ingress controller, domain and TLS certificate if public HTTP access is wanted. `ingress.example.yaml` is an optional example; it is not included in the base.

The example Secret and Ingress are intentionally excluded from `kustomization.yaml`. The Deployment will not become ready without the real Secret and a working database. No Kubernetes resources are applied automatically by the application or the local development workflow.

Offline manifest rendering:

```sh
kubectl kustomize deploy/kubernetes > /tmp/2010scape-web-rendered.yaml
```

After infrastructure and secrets have been prepared, an operator can deploy the base with `kubectl apply -k deploy/kubernetes`. The image, example hostname and credentials must be replaced first. The manifests do not provision PostgreSQL or a public load balancer.

Set `SITE_ORIGIN` to the public HTTPS origin when running behind a proxy. Login attempts are limited to ten per fifteen minutes for each direct TCP peer IP; forwarded client-IP headers are intentionally not trusted. A reverse proxy may therefore aggregate visitors under one limit. Configure an appropriate edge rate limit and account for this when choosing the proxy topology.

The pod drops capabilities, has no service-account token, runs without root and uses a read-only root filesystem with a bounded temporary directory. Readiness removes pods from service during database outages without making the liveness probe depend on the database. Resource requests and limits are starting values; tune them using measurements.

## Scope and validation

The website is separate from the game server. These files do not deploy a RuneScape world, serve its cache, or modify a running client. See [the architecture notes](kubernetes-architecture.md) for the transport and persistence boundaries.

Docker builds require an already running Docker engine. If that engine is unavailable, validate the Compose configuration and Kustomize output offline and record that the image build and PostgreSQL-container integration were not exercised. Do not start Docker Desktop, OrbStack or a cluster as a side effect of repository checks.

Validation passed with OrbStack Docker 29.8.2: the Bun 1.4.3 image built with a 32.58 kB build context, and two disposable website containers shared PostgreSQL 17. Checks covered simultaneous startup, UID 1000 with a read-only root filesystem, cross-replica login/CSRF, draft privacy, publishing/unpublishing, announcement/session persistence after an application restart, and SIGTERM exit status 0. Test containers, database volume and network were removed afterward. Compose configuration, Kustomize rendering and YAML/security checks also passed. No Kubernetes deployment was applied.

The PostgreSQL healthcheck uses TCP explicitly: its temporary initialization server can accept Unix-socket checks before TCP is available. During a real PostgreSQL outage, `/readyz` returned HTTP 503 in 2.009 seconds while `/healthz` stayed HTTP 200. Restarting PostgreSQL restored HTTP 200 readiness on both replicas and retained the administrator session. Readiness has a two-second deadline, below the Kubernetes probe's three-second timeout.

The final original-template image was also validated with an isolated read-only archive bind mount and in-memory SQL: the homepage retained the original banner/menu HTML, and the archived guide, original CSS, image and responsive overlay returned HTTP 200. The archive mount was confirmed read-only and sampled host HTML/CSS/image hashes were unchanged. The final build context was 41.35 kB and `/app/local/` contained no reference archive/assets. Running the same image without an archive mount served the fallback homepage with HTTP 200 readiness. Both temporary containers were removed.
