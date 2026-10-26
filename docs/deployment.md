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

The initial offline checks passed: `docker compose config --quiet`, Kustomize rendering, YAML parsing, manifest security/readiness checks and `git diff --check`. The Docker daemon and local PostgreSQL binaries were unavailable, so the container image and PostgreSQL runtime path were not tested.
