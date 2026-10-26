import { SQL } from "bun";
import { mkdir } from "node:fs/promises";
export interface Announcement {
  id: string;
  title: string;
  body: string;
  state: string;
  created_at: number;
  updated_at: number;
  published_at: number | null;
}
export class ValidationError extends Error {}

export class Store {
  sql: SQL;
  constructor(url: string) {
    this.sql = new SQL(url);
  }
  static async open(url = "sqlite://./local/data/site.sqlite") {
    if (url === "sqlite://./local/data/site.sqlite")
      await mkdir("local/data", { recursive: true });
    const store = new Store(url);
    await store.sql.begin(async (tx) => {
      if (/^postgres(?:ql)?:/.test(url))
        await tx`SELECT pg_advisory_xact_lock(2010623)`;
      await tx`CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('draft','published')), created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, published_at BIGINT)`;
      await tx`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, admin INTEGER NOT NULL, expires_at BIGINT NOT NULL)`;
      await tx`CREATE TABLE IF NOT EXISTS login_limits (id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at BIGINT NOT NULL)`;
    });
    return store;
  }
  async list(admin = false): Promise<Announcement[]> {
    return admin
      ? await this
          .sql`SELECT * FROM announcements ORDER BY created_at DESC, id DESC`
      : await this
          .sql`SELECT * FROM announcements WHERE state = 'published' ORDER BY published_at DESC, id DESC`;
  }
  async get(id: string, admin = false): Promise<Announcement | undefined> {
    const rows = admin
      ? await this.sql`SELECT * FROM announcements WHERE id = ${id}`
      : await this
          .sql`SELECT * FROM announcements WHERE id = ${id} AND state = 'published'`;
    return rows[0];
  }
  async save(input: {
    id?: string;
    title: string;
    body: string;
    state: string;
  }) {
    const id = input.id ?? crypto.randomUUID(),
      now = Date.now();
    if (
      !input.title.trim() ||
      input.title.length > 160 ||
      !input.body.trim() ||
      input.body.length > 30000 ||
      !["draft", "published"].includes(input.state)
    )
      throw new ValidationError(
        "Enter a title (up to 160 characters), body (up to 30,000 characters), and valid publication state.",
      );
    return this.sql.begin(async (tx) => {
      if (input.id) {
        const old = (await tx`SELECT * FROM announcements WHERE id = ${id}`)[0];
        if (!old) throw new ValidationError("Announcement not found.");
        const published =
          input.state === "published" ? (old.published_at ?? now) : null;
        await tx`UPDATE announcements SET title=${input.title.trim()}, body=${input.body.trim()}, state=${input.state}, updated_at=${now}, published_at=${published} WHERE id=${id}`;
      } else {
        await tx`INSERT INTO announcements VALUES (${id}, ${input.title.trim()}, ${input.body.trim()}, ${input.state}, ${now}, ${now}, ${input.state === "published" ? now : null})`;
      }
      return id;
    });
  }
  async loginAttempt(key: string) {
    const now = Date.now(),
      expiry = now + 15 * 60_000;
    // Single atomic statement across both SQLite and PostgreSQL, including multiple replicas.
    const rows = await this
      .sql`INSERT INTO login_limits (id, attempts, expires_at) VALUES (${key}, 1, ${expiry}) ON CONFLICT (id) DO UPDATE SET attempts = CASE WHEN login_limits.expires_at < ${now} THEN 1 ELSE login_limits.attempts + 1 END, expires_at = CASE WHEN login_limits.expires_at < ${now} THEN ${expiry} ELSE login_limits.expires_at END RETURNING attempts`;
    return Number(rows[0].attempts) <= 10;
  }
  async close() {
    await this.sql.close();
  }
}
