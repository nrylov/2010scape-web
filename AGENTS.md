# Contributor notes

This repository contains the TypeScript website for 2010scape. Keep the period-2010 appearance while implementing modern responsive layout and server-backed announcements.

- The reference archive is `local/assets/website_source.7z`. NEVER commit this archive, extracted Jagex assets, credentials, database files, machine-specific files or runtime data. Derived reference assets remain under gitignored `local/` and are excluded from Docker contexts.
- Keep the website separate from the game server. Use environment-based endpoints rather than importing its source or relying on a sibling checkout at runtime.
- Public news must exclude drafts. Validate and escape submitted content; administrative writes require authentication and CSRF protection. Never provide a committed default administrator password.
- Local development should work without Kubernetes. Production containers must run without root and expose health/readiness checks; production database state must survive pod replacement. PostgreSQL supports shared website state; game worlds remain separately authoritative processes.
- Use Bun and TypeScript, with the runtime pinned in `mise.toml`. Run the project checks and verify the rendered desktop/mobile pages before committing. Include database/authentication/draft-publication coverage.
- Document configuration, archive import and deployment limitations in README/docs. Do not deploy to external infrastructure as part of local development.
