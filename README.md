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

The homepage is loaded from the original `index.html`, including its navigation, banner, parchment panels, sidebar and footer. Published announcements replace the original recent-news entries, and configured game status replaces the old player count. News, play, status and administration pages reuse that original HTML shell. The game guide, downloads/wallpapers and other captured pages use native 2010scape routes such as `/game-guide`, `/downloads-and-wallpapers` and `/guide/...`, with their original styles and images. Legacy `/archive/...` URLs redirect to native pages; assets use `/assets/...`. Original scripts, tracking, Java applets and obsolete account forms do not execute. See [native pages and mobile layouts](docs/native-pages-and-mobile.md).

`public/site-overrides.css` adds mobile layouts and styling for new application forms. It does not replace the original desktop styles. Without the archive, a minimal setup page and application routes remain available; the original appearance requires the separately supplied source files.

No archive, mirrored HTML or Jagex image/CSS assets belong in commits or container images. All extracted files remain gitignored. See [local/README.md](local/README.md).

## Announcements and integrations

Administration is disabled until configured. Set `ADMIN_PASSWORD` in your untracked `.env`, run `bun run password:hash`, then replace the plaintext setting with the printed hash in single quotes (`ADMIN_PASSWORD_HASH='$argon2id$…'`). Restart and visit `/admin`. Administrators can create, edit, publish and unpublish news or developer posts; drafts remain private. The editor includes formatting controls and a live preview for headings, bold/italic text, links, lists and inline pictures. New posts use safe Markdown; older posts keep their plain-text formatting until explicitly changed. Raw HTML is escaped. Pictures accept HTTPS URLs or local `/assets/...` paths; file uploads are not implemented. The forum composer has the same toolbar and safe preview.

News articles and `/news` lists use the original archived news templates (`newsitemc007.html`, with `newsitem13fe.html` as a fallback, and `list.html`). Developer articles and `/devblog` lists use the original `view_postfe29.html` and `index.html` templates, with author, project and tag metadata, filtering and pagination. The Community menu links to news, developer blogs and forums. These live pages require the corresponding extracted archive files for their original layouts; without them a basic application page remains available.

`DOWNLOAD_URL` enables a real client download. `GAME_STATUS_URL` optionally points to an HTTP JSON endpoint such as `{ "online": true, "players": 12 }`. Missing or unavailable monitoring reports unknown status. Game accounts remain managed by the game server.

## Verify and deploy

```sh
bun run check
```

Checks cover authentication, CSRF, drafts/publication, persistence, readiness, original-template integration, local archive links/assets and safe file routing. Review original desktop and 320/390-pixel layouts after template changes. `/healthz` checks HTTP availability; `/readyz` also checks the database with a two-second deadline.

See [deployment instructions](docs/deployment.md) and [architecture notes](docs/kubernetes-architecture.md). Containers mount the original website tree read-only through `WEBSITE_ARCHIVE_ROOT`; they do not package it. Production uses PostgreSQL and HTTPS. Docker/PostgreSQL integration has exercised two replicas, shared sessions, persistence and outage recovery. A local OrbStack deployment is running in the isolated `2010scape-test` namespace. See [the OrbStack workflow](deploy/orbstack/README.md) for setup, private administrator credentials and persistence checks. The website is available at http://2010scape-web.2010scape-test.svc.cluster.local and uses a separately deployed game Service for live status.

Publishing/forum audit: TypeScript checks and 36 website tests pass. See [publishing and forum notes](docs/publishing-and-forums.md) for editing, administrator access and visual verification limits. Original homepage, guide/news pages and application pages were reviewed at 320, 390 and 1440 pixels with no missing rendering assets or horizontal overflow. A built container served the original HTML/CSS/images through a read-only archive mount; the archive remained outside the image and host asset hashes were unchanged.

OrbStack validation: original archived pages/assets, authentication/CSRF, announcement publishing, 32 consecutive readiness/authenticated reads, pod replacement and PostgreSQL outage/recovery passed. Website and database pods remain running with persistent storage; the game world has its own pod and character-data PVC. Generated credentials and host paths remain ignored under `local/deploy/orbstack/`.

Forums at `/forums` now connect to the application router. Administrator sessions can post and moderate; visitors can read and search. This iteration uses one website administrator account; public accounts and external authentication are deferred. See [publishing and forums](docs/publishing-and-forums.md).

Grand Exchange previews at `/grand-exchange` provide original-template item pages, contrived price histories and 30/90/180-day graphs. `/hiscores` provides skill rankings and profiles with clearly labeled sample data. See [market and hiscores notes](docs/market-and-hiscores.md); live data services and game GE work remain future work.
