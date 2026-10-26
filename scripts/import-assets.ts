import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const destination = resolve(root, "local/website-reference");
const index = resolve(destination, "2010-07-18/www.runescape.com/index.html");
if (await Bun.file(index).exists()) {
  console.log("Using the existing extracted website at local/website-reference/2010-07-18.");
  process.exit(0);
}
const archive = resolve(root, "local/assets/website_source.7z");
if (!(await Bun.file(archive).exists())) {
  console.error("Place website_source.7z under local/assets/ or extract the site into local/website-reference/2010-07-18.");
  process.exit(1);
}
const tool = Bun.which("7zz") || Bun.which("7z");
if (!tool) {
  console.error("Install 7-Zip (7zz or 7z) before importing the archive.");
  process.exit(1);
}
await mkdir(destination, { recursive: true });
const result = Bun.spawn([tool, "x", "-y", `-o${destination}`, archive], { stdout: "inherit", stderr: "inherit" });
if ((await result.exited) !== 0) process.exit(1);
if (!(await Bun.file(index).exists())) {
  console.error("The extracted tree must contain 2010-07-18/www.runescape.com/index.html.");
  process.exit(1);
}
console.log("Original website extracted into ignored local/website-reference. No source files or assets are copied into Git.");
