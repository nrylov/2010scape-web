# Local website files

Keep `assets/website_source.7z` and the extracted full website under `website-reference/2010-07-18/`. The runtime reads the actual original HTML, CSS and images from this date root. Everything here except this README is gitignored and excluded from container images. `bun run assets:import` extracts the full archive if it is not already present.

Do not commit the archive, mirrored pages, Jagex assets, logs, credentials or database files. Container deployments mount the extracted tree read-only and set `WEBSITE_ARCHIVE_ROOT` to that mount. SQLite development state is stored separately under `local/data/`.
