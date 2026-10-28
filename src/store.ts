import {sqlTransaction} from "./sql-transactions";
import { SQL } from "bun";
import { mkdir } from "node:fs/promises";
export type PostKind = "news" | "devblog";
export interface Announcement {
  kind: PostKind;
  format: "plain" | "markdown";
  author: string;
  category: string;
  project: string;
  tags: string;
  summary: string;
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
  private readonly postgres: boolean;
  private readinessFlight?: Promise<boolean>;
  constructor(url: string) {
    this.postgres = /^postgres(?:ql)?:/.test(url);
    this.sql = this.postgres
      ? new SQL(url, { connectionTimeout: 2 })
      : new SQL(url);
  }
  /** One bounded probe per process, even when Kubernetes sends overlapping probes. */
  ready(timeoutMs = 2000): Promise<boolean> {
    if (this.readinessFlight) return this.readinessFlight;
    const controller = new AbortController();
    let reserved: Awaited<ReturnType<SQL["reserve"]>> | undefined;
    let cancel: (() => void) | undefined;
    let timedOut = false;
    const work = (async () => {
      try {
        // Reserve only the probe's connection so an outage deadline can close it
        // without cancelling announcement writes on other pool connections.
        if (this.postgres)
          reserved = await this.sql.reserve({ signal: controller.signal });
        if (controller.signal.aborted) return false;
        const query = (reserved ?? this.sql)`SELECT 1`;
        cancel = () => {
          query.cancel();
        };
        await query;
        return true;
      } catch {
        return false;
      } finally {
        if (reserved) {
          if (timedOut) void reserved.close({ timeout: 0 }).catch(() => {});
          else void reserved.release().catch(() => {});
        }
      }
    })();
    const result = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        try {
          cancel?.();
        } catch {
          /* The deadline still returns if a driver rejects cancellation. */
        }
        if (reserved) void reserved.close({ timeout: 0 }).catch(() => {});
        resolve(false);
      }, timeoutMs);
      work.then((healthy) => {
        clearTimeout(timer);
        resolve(healthy);
        if (this.readinessFlight === result) this.readinessFlight = undefined;
      });
    });
    // Keep sharing the failed result until the cancelled operation settles.
    // Even a driver that cannot finish cancellation cannot accumulate probes.
    this.readinessFlight = result;
    return result;
  }
  static async open(url = "sqlite://./local/data/site.sqlite") {
    if (url === "sqlite://./local/data/site.sqlite")
      await mkdir("local/data", { recursive: true });
    const store = new Store(url);
    await sqlTransaction(store.sql, async (tx) => {
      if (/^postgres(?:ql)?:/.test(url))
        await tx`SELECT pg_advisory_xact_lock(2010623)`;
      await tx`CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('draft','published')), created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, published_at BIGINT)`;
      // Existing announcement databases remain readable; plain text is never reinterpreted as Markdown.
      const columns = /^postgres(?:ql)?:/.test(url)
        ? (await tx`SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'announcements'`).map((row: any) => row.name)
        : (await tx`PRAGMA table_info(announcements)`).map((row: any) => row.name);
      for (const [name, fallback] of Object.entries({kind:'news',format:'plain',author:'2010scape team',category:'Game Updates',project:'Development',tags:'',summary:''})) {
        if (!columns.includes(name)) await tx.unsafe(`ALTER TABLE announcements ADD COLUMN ${name} TEXT NOT NULL DEFAULT '${fallback}'`);
      }
      await tx`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, admin INTEGER NOT NULL, expires_at BIGINT NOT NULL)`;
      await tx`CREATE TABLE IF NOT EXISTS login_limits (id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at BIGINT NOT NULL)`;
    });
    return store;
  }
  async list(admin = false, kind?: PostKind): Promise<Announcement[]> {
    const selected = kind ?? (admin ? undefined : 'news');
    if (admin) return selected
      ? await this.sql`SELECT * FROM announcements WHERE kind=${selected} ORDER BY created_at DESC, id DESC`
      : await this.sql`SELECT * FROM announcements ORDER BY created_at DESC, id DESC`;
    return await this.sql`SELECT * FROM announcements WHERE state='published' AND kind=${selected} ORDER BY published_at DESC, id DESC`;
  }
  async get(id: string, admin = false): Promise<Announcement | undefined> {
    const rows = admin
      ? await this.sql`SELECT * FROM announcements WHERE id=${id}`
      : await this.sql`SELECT * FROM announcements WHERE id=${id} AND state='published'`;
    return rows[0];
  }
  async save(input: {
    id?: string; title: string; body: string; state: string; kind?: string;
    format?: string; author?: string; category?: string; project?: string; tags?: string; summary?: string;
  }) {
    const id = input.id ?? crypto.randomUUID(), now = Date.now();
    const old = input.id ? await this.get(input.id, true) : undefined;
    if (input.id && !old) throw new ValidationError('Announcement not found.');
    const kind = input.kind ?? old?.kind ?? 'news', format = input.format ?? old?.format ?? 'plain';
    const author = (input.author ?? old?.author ?? '2010scape team').trim();
    const category = (input.category ?? old?.category ?? 'Game Updates').trim();
    const project = (input.project ?? old?.project ?? 'Development').trim();
    const tags = (input.tags ?? old?.tags ?? '').trim(), summary = (input.summary ?? old?.summary ?? '').trim();
    if (!input.title.trim() || input.title.length > 160 || !input.body.trim() || input.body.length > 30000
      || !['draft','published'].includes(input.state) || !['news','devblog'].includes(kind)
      || !['plain','markdown'].includes(format) || author.length > 80 || category.length > 80
      || project.length > 100 || tags.length > 300 || summary.length > 500)
      throw new ValidationError('Enter a title (up to 160 characters), body (up to 30,000 characters), and valid publication and formatting settings.');
    return sqlTransaction(this.sql, async tx => {
      if (input.id) {
        const current = (await tx`SELECT * FROM announcements WHERE id=${id}`)[0];
        if (!current) throw new ValidationError('Announcement not found.');
        const published = input.state === 'published' ? (current.published_at ?? now) : null;
        await tx`UPDATE announcements SET title=${input.title.trim()},body=${input.body.trim()},state=${input.state},updated_at=${now},published_at=${published},kind=${kind},format=${format},author=${author},category=${category},project=${project},tags=${tags},summary=${summary} WHERE id=${id}`;
      } else {
        await tx`INSERT INTO announcements (id,title,body,state,created_at,updated_at,published_at,kind,format,author,category,project,tags,summary) VALUES (${id},${input.title.trim()},${input.body.trim()},${input.state},${now},${now},${input.state==='published'?now:null},${kind},${format},${author},${category},${project},${tags},${summary})`;
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
