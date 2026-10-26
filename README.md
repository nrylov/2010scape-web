# 2010scape website

The website uses the **actual archived 2010 runescape.com HTML, CSS and images** as its runtime foundation. TypeScript/Bun adapts that source into a working site with dynamic announcements, administration and additive responsive styles. Original files stay untouched under ignored `local/`; the repository contains the adapter and application code.

## Run locally

Install Bun (tested with 1.4.3; `mise install` uses `mise.toml`), then:

```sh
bun install --frozen-lockfile
cp .env.example .env
bun run assets:import
bun run start
```

Open http://localhost:3000. Bun reads `.env` automatically. The SQLite development database is `local/data/site.sqlite`; announcements and sessions survive restarts. The game server is independent.

## Original website files

Use the full extracted date folder:

```text
local/website-reference/2010-07-18/
  www.runescape.com/index.html
  www.runescape.com/css/
  www.runescape.com/img/
  services.runescape.com/
  ...
```

If it is already extracted, `assets:import` leaves it in place. Otherwise it extracts `local/assets/website_source.7z` using 7-Zip (`7zz` or `7z`). `WEBSITE_ARCHIVE_ROOT` can point to another date-root directory.

The homepage is loaded from the original `index.html`, including its navigation, banner, parchment panels, sidebar and footer. Published announcements replace the original recent-news entries, and configured game status replaces the old player count. News, play, status and administration pages reuse that original HTML shell. The game guide and historical news pages are served locally under `/archive/<original-host>/<path>` with their original styles and images. Original scripts, tracking, Java applets and obsolete account forms do not execute; historical pages carry a reference notice.

`public/site-overrides.css` adds mobile layouts and styling for new application forms. It does not replace the original desktop styles. Without the archive, a minimal setup page and application routes remain available; the original appearance requires the separately supplied source files.

No archive, mirrored HTML or Jagex image/CSS assets belong in commits or container images. All extracted files remain gitignored. See [local/README.md](local/README.md).

## Announcements and integrations

Administration is disabled until configured. Set `ADMIN_PASSWORD` in your untracked `.env`, run `bun run password:hash`, then replace the plaintext setting with the printed hash in single quotes (`ADMIN_PASSWORD_HASH='$argon2id$…'`). Restart and visit `/admin`. Administrators can create, edit, publish and unpublish announcements; drafts remain private. Bodies use escaped plain text with paragraphs preserved.

`DOWNLOAD_URL` enables a real client download. `GAME_STATUS_URL` optionally points to an HTTP JSON endpoint such as `{ "online": true, "players": 12 }`. Missing or unavailable monitoring reports unknown status. Game accounts remain managed by the game server.

## Verify and deploy

```sh
bun run check
```

Checks cover authentication, CSRF, drafts/publication, persistence, readiness, original-template integration, local archive links/assets and safe file routing. Review original desktop and 320/390-pixel layouts after template changes. `/healthz` checks HTTP availability; `/readyz` also checks the database with a two-second deadline.

See [deployment instructions](docs/deployment.md) and [architecture notes](docs/kubernetes-architecture.md). Containers mount the original website tree read-only through `WEBSITE_ARCHIVE_ROOT`; they do not package it. Production uses PostgreSQL and HTTPS. Docker/PostgreSQL integration has exercised two replicas, shared sessions, persistence and outage recovery. A local OrbStack deployment is running in the isolated `2010scape-test` namespace. See [the OrbStack workflow](deploy/orbstack/README.md) for setup, private administrator credentials and persistence checks. The website is available at http://2010scape-web.2010scape-test.svc.cluster.local and uses a separately deployed game Service for live status.

Validation: TypeScript checks and 17 tests (182 assertions) pass. Original homepage, guide/news pages and application pages were reviewed at 320, 390 and 1440 pixels with no missing rendering assets or horizontal overflow. A built container served the original HTML/CSS/images through a read-only archive mount; the archive remained outside the image and host asset hashes were unchanged.

OrbStack validation: original archived pages/assets, authentication/CSRF, announcement publishing, 32 consecutive readiness/authenticated reads, pod replacement and PostgreSQL outage/recovery passed. Website and database pods remain running with persistent storage; the game world has its own pod and character-data PVC. Generated credentials and host paths remain ignored under `local/deploy/orbstack/`.
