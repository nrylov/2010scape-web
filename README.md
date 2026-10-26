# 2010scape website

A TypeScript/Bun website for the revision 623 server, with a responsive 2010-inspired portal and persistent announcements. Run it locally with SQLite, or use PostgreSQL for shared storage across Kubernetes replicas.

## Run locally

Install Bun (tested with 1.4.3; `mise install` uses `mise.toml`), then:

```sh
bun install --frozen-lockfile
cp .env.example .env
bun run start
```

Open http://localhost:3000. Bun reads `.env` automatically. The default SQLite database is `local/data/site.sqlite`; restarting preserves announcements and sessions. Administration is disabled until you configure a password. No game server is required to run the website.

To enable administration, set `ADMIN_PASSWORD` in your untracked `.env`, run `bun run password:hash`, then replace that plaintext setting with `ADMIN_PASSWORD_HASH` containing the printed hash in single quotes (`ADMIN_PASSWORD_HASH='$argon2id$…'`) so dollar signs stay literal. Restart the website and visit `/admin`. Keep credentials out of Git. Administrators can create, edit, publish and unpublish announcements; drafts are private. Announcement bodies are plain text with paragraphs preserved.

`DOWNLOAD_URL` enables a real client download link. `GAME_STATUS_URL` optionally points to an HTTP endpoint returning JSON such as `{ "online": true, "players": 12 }`. Without a configured, working endpoint the website reports status as unknown. Game accounts remain managed by the game server.

## Archived reference assets

The archive is stored at `local/assets/website_source.7z` and is ignored by Git. With 7-Zip installed, run:

```sh
bun run assets:import
```

This extracts a fixed allowlist of original images and CSS references into `local/`. It never serves archived HTML or scripts. The optional banner is served from `local/reference-assets/`; the site also works without it. No archive or Jagex assets belong in commits or container images. See [local/README.md](local/README.md).

## Verify

```sh
bun run check
```

This runs TypeScript checks and application tests covering authentication, CSRF, private drafts, publication, escaping, persistence, rate limits and unavailable game status. `/healthz` checks HTTP availability; `/readyz` also checks the database.

## Containers and Kubernetes

See [deployment instructions](docs/deployment.md) and [architecture notes](docs/kubernetes-architecture.md) for Docker Compose and Kubernetes manifests. Production uses PostgreSQL, HTTPS and secure cookies. The manifests are templates; no cluster deployment is performed by this repository.

Keep website HTTP traffic and game TCP/JS5 traffic in separate workloads. Website replicas can share PostgreSQL; a game world remains one authoritative server with persistent account, cache and key storage.

Validation: 9 application tests (68 assertions) and TypeScript checks pass. Desktop and 320/390-pixel mobile layouts have been reviewed in Chromium. Compose configuration and Kustomize rendering pass offline checks; the Docker image and PostgreSQL integration have also been exercised with two isolated replicas, shared login sessions, announcement persistence and graceful shutdown. Kubernetes manifests have not been applied to a cluster.
