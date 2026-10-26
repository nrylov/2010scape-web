import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const archive = resolve(root, "local/assets/website_source.7z");
if (!(await Bun.file(archive).exists())) {
  console.error(
    "No archive found at local/assets/website_source.7z. The website works without reference assets.",
  );
  process.exit(1);
}
const tool = Bun.which("7zz") || Bun.which("7z");
if (!tool) {
  console.error("Install 7-Zip (7zz or 7z), then run this command again.");
  process.exit(1);
}
// Extract a fixed allowlist into ignored local/, never into public/ or a build artifact.
const base = "2010-07-18/www.runescape.com/";
const entries = [
  "css/global-34.css",
  "css/home-32.css",
  "img/main/home/bgcfcd.jpg",
  "img/main/home/bannerLogoc4ca.jpg",
];
const destination = resolve(root, "local/archive-reference");
await mkdir(destination, { recursive: true });
const proc = Bun.spawn(
  [
    tool,
    "x",
    "-y",
    `-o${destination}`,
    archive,
    ...entries.map((name) => base + name),
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if ((await proc.exited) !== 0) process.exit(1);
const assets = resolve(root, "local/reference-assets");
await mkdir(assets, { recursive: true });
await copyFile(
  resolve(destination, base, "img/main/home/bgcfcd.jpg"),
  resolve(assets, "banner.jpg"),
);
console.log(
  "Imported local/reference-assets/banner.jpg and CSS references under local/archive-reference. All remain ignored. No archive HTML, scripts, tracking or external links were imported.",
);
