import { createApp } from "./app";
const app = await createApp({
  databaseUrl: process.env.DATABASE_URL,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,
  secureCookie: process.env.SESSION_COOKIE_SECURE
    ? process.env.SESSION_COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production",
  siteOrigin: process.env.SITE_ORIGIN,
  gameStatusUrl: process.env.GAME_STATUS_URL,
  gameMarketUrl: process.env.GAME_MARKET_URL,
  downloadUrl: process.env.DOWNLOAD_URL,
  archiveRoot: process.env.WEBSITE_ARCHIVE_ROOT,
});
const server = Bun.serve({
  port: Number(process.env.PORT || 3000),
  hostname: process.env.BIND_HOST || "0.0.0.0",
  maxRequestBodySize: 100_000,
  fetch: (req, server) =>
    app.handle(req, server.requestIP(req)?.address ?? "unknown"),
});
console.log(`2010scape website listening on ${server.url}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
