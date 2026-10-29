# Contributor notes

This repository contains the TypeScript website for 2010scape. Use the actual original HTML/CSS/images from `local/website-reference/2010-07-18/` as the runtime foundation, with additive responsive CSS and server-backed announcements. Do not substitute a recreated theme.

- The reference archive is `local/assets/website_source.7z`; its full extracted tree is `local/website-reference/2010-07-18/`. NEVER commit this archive, extracted Jagex assets, credentials, database files, machine-specific files or runtime data. Derived reference assets remain under gitignored `local/` and are excluded from Docker contexts.
- Keep the website separate from the game server. Use environment-based endpoints rather than importing its source or relying on a sibling checkout at runtime.
- Public news must exclude drafts. Validate and escape submitted content; administrative writes require authentication and CSRF protection. Never provide a committed default administrator password.
- Local development should work without Kubernetes. Production containers must run without root and expose health/readiness checks; production database state must survive pod replacement. PostgreSQL supports shared website state; game worlds remain separately authoritative processes.
- Use Bun and TypeScript, with the runtime pinned in `mise.toml`. Run the project checks and verify the rendered desktop/mobile pages before committing. Include database/authentication/draft-publication coverage.
- Document configuration, archive import and deployment limitations in README/docs. Do not deploy to external infrastructure as part of local development.

- Publishing and forums reuse the original news/devblog/forum templates. `/admin` supports Markdown formatting and previews; `/forums` currently uses the same single website administrator account for posting/moderation, with public reading/search. Do not read game character files from the website. An account database or external auth service is future work. See `docs/publishing-and-forums.md` for audited coverage and limits (2026-10-28).

- `/grand-exchange` and `/hiscores` use original templates with labeled contrived data behind `PriceHistorySource` and `HiscoresProvider`. Live GE/history ingestion and hiscores data are deferred; see `docs/market-and-hiscores.md`.
- Devblog filtering must replace the archived `form#filter` completely; do not inject another form inside it or preserve the archive sanitizer's inert/disabled state. Preserve original filter IDs and button art.

- All captured pages/assets must use native routes from `src/site-routes.ts`; old `/archive/...` paths are compatibility redirects only. Preserve original assets and traversal/symlink protections. Run `bun scripts/audit-native-routes.ts` for the full captured-page inventory. Phone layouts were checked across 16 pages at 320/390/600px; see `docs/native-pages-and-mobile.md`.
