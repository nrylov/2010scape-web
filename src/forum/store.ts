import type { SQL } from "bun";
import { sqlTransaction } from "../sql-transactions";

export type ForumRole = "member" | "moderator" | "admin" | "banned";
export interface ForumActor { id: string; name: string; role: ForumRole; csrf: string; }
export interface ForumCategory { id: string; title: string; position: number; }
export interface ForumBoard { id: string; category_id: string; title: string; description: string; icon: string; position: number; locked: number; staff_threads: number; thread_count?: number; post_count?: number; last_post?: number | null; }
export interface ForumThread { id: string; board_id: string; title: string; author_id: string; author_name: string; pinned: number; locked: number; hidden: number; created_at: number; updated_at: number; post_count?: number; }
export interface ForumPost { id: string; thread_id: string; position: number; author_id: string; author_name: string; body: string; hidden: number; created_at: number; updated_at: number; author_role?: ForumRole; }
export class ForumError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export const moderator = (actor: Pick<ForumActor, "role">) => actor.role === "admin" || actor.role === "moderator";
const content = (value: string, label: string, max: number) => {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new ForumError(`${label} must contain 1–${max.toLocaleString("en")} characters.`);
  return value.trim();
};
const seed = [
  ["official", "Official", [["announcements", "News & Announcements", "Discuss the latest 2010scape announcements.", "news_announcements_2.gif", 1], ["development", "Developer Blogs", "Discuss development updates and work in progress.", "Jl_icon.jpg", 1]]],
  ["community", "Community", [["general", "General", "Talk about your adventures in 2010scape.", "general_2.gif", 0], ["suggestions", "Suggestions & Feedback", "Share ideas and constructive feedback.", "suggestions_2.gif", 0], ["clans", "Clans & Events", "Find a clan, recruit adventurers and organise events.", "clan_discussions.jpg", 0]]],
  ["help", "Help & Support", [["quests", "Quests", "Ask for help with quests and puzzles.", "quest.gif", 0], ["skills", "Skills", "Discuss training, resources and skill techniques.", "skills_2.gif", 0], ["support", "Technical Support", "Get help connecting and report problems.", "tech_support_2.gif", 0]]],
  ["market", "Marketplace", [["marketplace", "Marketplace", "Buy, sell and discuss items with other players.", "misc_2.gif", 0]]],
] as const;

/** Shared SQL tables work with SQLite locally and PostgreSQL in Kubernetes. */
export class ForumStore {
  private constructor(readonly sql: SQL) {}
  static async init(sql: SQL) {
    await sqlTransaction(sql, async tx => {
      if (sql.options.adapter === "postgres") await tx`SELECT pg_advisory_xact_lock(2010624)`;
      await tx`CREATE TABLE IF NOT EXISTS forum_categories (id TEXT PRIMARY KEY, title TEXT NOT NULL, position INTEGER NOT NULL)`;
      await tx`CREATE TABLE IF NOT EXISTS forum_boards (id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES forum_categories(id), title TEXT NOT NULL, description TEXT NOT NULL, icon TEXT NOT NULL, position INTEGER NOT NULL, locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)), staff_threads INTEGER NOT NULL DEFAULT 0 CHECK(staff_threads IN (0,1)), updated_at BIGINT NOT NULL)`;
      await tx`CREATE TABLE IF NOT EXISTS forum_profiles (account_id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','moderator','admin','banned')), last_seen BIGINT NOT NULL)`;
      await tx`CREATE TABLE IF NOT EXISTS forum_threads (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES forum_boards(id), title TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)), locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)), hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)), created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`;
      await tx`CREATE TABLE IF NOT EXISTS forum_posts (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES forum_threads(id), position INTEGER NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL, body TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)), created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`;
      await tx`CREATE TABLE IF NOT EXISTS forum_post_edits (id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES forum_posts(id), actor_id TEXT NOT NULL, previous_body TEXT NOT NULL, created_at BIGINT NOT NULL)`;
      await tx`CREATE TABLE IF NOT EXISTS forum_moderation (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at BIGINT NOT NULL)`;
      await tx`CREATE TABLE IF NOT EXISTS forum_write_limits (id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at BIGINT NOT NULL)`;
      await tx`CREATE INDEX IF NOT EXISTS forum_threads_board_sort ON forum_threads(board_id, pinned, updated_at)`;
      await tx`CREATE INDEX IF NOT EXISTS forum_posts_thread_sort ON forum_posts(thread_id, position)`;
      await tx`CREATE UNIQUE INDEX IF NOT EXISTS forum_posts_position ON forum_posts(thread_id,position)`;
      for (const [position, [id, title, boards]] of seed.entries()) {
        await tx`INSERT INTO forum_categories (id,title,position) VALUES (${id},${title},${position}) ON CONFLICT(id) DO NOTHING`;
        for (const [order, [board, heading, description, icon, staff]] of boards.entries()) await tx`INSERT INTO forum_boards (id,category_id,title,description,icon,position,locked,staff_threads,updated_at) VALUES (${board},${id},${heading},${description},${icon},${order},0,${staff},${Date.now()}) ON CONFLICT(id) DO NOTHING`;
      }
    });
    return new ForumStore(sql);
  }
  async identify(actor: ForumActor): Promise<ForumActor> {
    if (!actor.id || actor.id.length > 128 || !actor.name || actor.name.length > 40) throw new ForumError("Invalid account identity.", 401);
    await this.sql`INSERT INTO forum_profiles (account_id,name,role,last_seen) VALUES (${actor.id},${actor.name},'member',${Date.now()}) ON CONFLICT(account_id) DO UPDATE SET name=${actor.name}, last_seen=${Date.now()}`;
    const row = (await this.sql`SELECT role FROM forum_profiles WHERE account_id=${actor.id}`)[0];
    // A website administrator session may moderate without conferring game rights.
    return { ...actor, role: actor.role === "admin" ? "admin" : row.role };
  }
  async categories(): Promise<ForumCategory[]> { return await this.sql`SELECT * FROM forum_categories ORDER BY position,id`; }
  async boards(includeHidden = false): Promise<ForumBoard[]> {
    const boards: ForumBoard[] = await this.sql`SELECT * FROM forum_boards ORDER BY position,id`;
    const totals: {board_id:string;thread_count:number;post_count:number;last_post:number|null}[] = await this.sql`SELECT t.board_id, COUNT(DISTINCT t.id) AS thread_count, COUNT(p.id) AS post_count, MAX(p.created_at) AS last_post FROM forum_threads t LEFT JOIN forum_posts p ON p.thread_id=t.id AND (${includeHidden ? 1 : 0}=1 OR p.hidden=0) WHERE (${includeHidden ? 1 : 0}=1 OR t.hidden=0) GROUP BY t.board_id`;
    const byId = new Map(totals.map(row => [row.board_id, row] as const));
    return boards.map(board => ({ ...board, thread_count: Number(byId.get(board.id)?.thread_count ?? 0), post_count: Number(byId.get(board.id)?.post_count ?? 0), last_post: byId.get(board.id)?.last_post ?? null }));
  }
  async board(id: string): Promise<ForumBoard | undefined> { return (await this.sql`SELECT * FROM forum_boards WHERE id=${id}`)[0]; }
  async threads(board: string | null, page = 1, includeHidden = false, query = "") {
    const pattern = `%${query.toLowerCase().slice(0,100)}%`, offset = (page - 1) * 20;
    const whereBoard = board ?? "";
    const total = (await this.sql`SELECT COUNT(*) AS n FROM forum_threads WHERE (${whereBoard}='' OR board_id=${whereBoard}) AND (${includeHidden ? 1 : 0}=1 OR hidden=0) AND LOWER(title) LIKE ${pattern}`)[0];
    const rows: ForumThread[] = await this.sql`SELECT t.*, (SELECT COUNT(*) FROM forum_posts p WHERE p.thread_id=t.id AND (${includeHidden ? 1 : 0}=1 OR p.hidden=0)) AS post_count FROM forum_threads t WHERE (${whereBoard}='' OR t.board_id=${whereBoard}) AND (${includeHidden ? 1 : 0}=1 OR t.hidden=0) AND LOWER(t.title) LIKE ${pattern} ORDER BY t.pinned DESC,t.updated_at DESC,t.id LIMIT 20 OFFSET ${offset}`;
    return { rows, total: Number(total.n), page };
  }
  async thread(id: string, includeHidden = false): Promise<ForumThread | undefined> { return (await this.sql`SELECT * FROM forum_threads WHERE id=${id} AND (${includeHidden ? 1 : 0}=1 OR hidden=0)`)[0]; }
  async posts(thread: string, page = 1, includeHidden = false) {
    const total = (await this.sql`SELECT COUNT(*) AS n FROM forum_posts WHERE thread_id=${thread} AND (${includeHidden ? 1 : 0}=1 OR hidden=0)`)[0];
    const rows: ForumPost[] = await this.sql`SELECT p.*, (SELECT role FROM forum_profiles f WHERE f.account_id=p.author_id) AS author_role FROM forum_posts p WHERE p.thread_id=${thread} AND (${includeHidden ? 1 : 0}=1 OR p.hidden=0) ORDER BY p.position,p.id LIMIT 10 OFFSET ${(page - 1) * 10}`;
    return { rows, total: Number(total.n), page };
  }
  async post(id: string, includeHidden = false): Promise<ForumPost | undefined> { return (await this.sql`SELECT * FROM forum_posts WHERE id=${id} AND (${includeHidden ? 1 : 0}=1 OR hidden=0)`)[0]; }
  async rate(key: string, limit = 10) {
    const now = Date.now(), expiry = now + 60000;
    const rows = await this.sql`INSERT INTO forum_write_limits (id,attempts,expires_at) VALUES (${key},1,${expiry}) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN forum_write_limits.expires_at < ${now} THEN 1 ELSE forum_write_limits.attempts+1 END, expires_at=CASE WHEN forum_write_limits.expires_at < ${now} THEN ${expiry} ELSE forum_write_limits.expires_at END RETURNING attempts`;
    if (Number(rows[0].attempts) > limit) throw new ForumError("You are posting too quickly. Please wait a minute.", 429);
  }
  private allowed(actor: ForumActor) { if (actor.role === "banned") throw new ForumError("This account cannot post on the forums.", 403); }
  async create(actor: ForumActor, board: string, heading: string, message: string) {
    this.allowed(actor); const title = content(heading,"Title",120), body = content(message,"Post",20000), now = Date.now(), id = crypto.randomUUID();
    return sqlTransaction(this.sql, async tx => {
      const rows = await tx`UPDATE forum_boards SET updated_at=updated_at WHERE id=${board} AND (locked=0 OR ${moderator(actor) ? 1 : 0}=1) AND (staff_threads=0 OR ${moderator(actor) ? 1 : 0}=1) RETURNING id`;
      if (!rows.length) throw new ForumError("This board is unavailable or does not allow you to create threads.",403);
      await tx`INSERT INTO forum_threads (id,board_id,title,author_id,author_name,pinned,locked,hidden,created_at,updated_at) VALUES (${id},${board},${title},${actor.id},${actor.name},0,0,0,${now},${now})`;
      await tx`INSERT INTO forum_posts (id,thread_id,position,author_id,author_name,body,hidden,created_at,updated_at) VALUES (${crypto.randomUUID()},${id},0,${actor.id},${actor.name},${body},0,${now},${now})`;
      return id;
    });
  }
  async reply(actor: ForumActor, thread: string, message: string) {
    this.allowed(actor); const body = content(message,"Post",20000), now = Date.now(), id = crypto.randomUUID();
    return sqlTransaction(this.sql, async tx => {
      const rows = await tx`UPDATE forum_threads SET updated_at=${now} WHERE id=${thread} AND (hidden=0 OR ${moderator(actor) ? 1 : 0}=1) AND (locked=0 OR ${moderator(actor) ? 1 : 0}=1) AND EXISTS (SELECT 1 FROM forum_boards b WHERE b.id=forum_threads.board_id AND (b.locked=0 OR ${moderator(actor) ? 1 : 0}=1)) RETURNING id`;
      if (!rows.length) throw new ForumError("This thread is unavailable or locked.",403);
      const next = (await tx`SELECT COALESCE(MAX(position),-1)+1 AS position FROM forum_posts WHERE thread_id=${thread}`)[0];
      await tx`INSERT INTO forum_posts (id,thread_id,position,author_id,author_name,body,hidden,created_at,updated_at) VALUES (${id},${thread},${Number(next.position)},${actor.id},${actor.name},${body},0,${now},${now})`;
      return id;
    });
  }
  async edit(actor: ForumActor, postId: string, message: string) {
    this.allowed(actor); const body = content(message,"Post",20000), now = Date.now();
    await sqlTransaction(this.sql, async tx => {
      const found = await tx`SELECT thread_id FROM forum_posts WHERE id=${postId}`;
      if (!found.length) throw new ForumError("Post not found.",404);
      const threads = await tx`UPDATE forum_threads SET updated_at=updated_at WHERE id=${found[0].thread_id} AND (locked=0 OR ${moderator(actor) ? 1 : 0}=1) AND (hidden=0 OR ${moderator(actor) ? 1 : 0}=1) RETURNING id`;
      if (!threads.length) throw new ForumError("This thread is locked or unavailable.",403);
      const posts = await tx`UPDATE forum_posts SET updated_at=updated_at WHERE id=${postId} AND (hidden=0 OR ${moderator(actor) ? 1 : 0}=1) RETURNING *`;
      const old = posts[0];
      if (!old) throw new ForumError("Post not found.",404);
      if (old.author_id !== actor.id && !moderator(actor)) throw new ForumError("You may only edit your own posts.",403);
      await tx`INSERT INTO forum_post_edits (id,post_id,actor_id,previous_body,created_at) VALUES (${crypto.randomUUID()},${postId},${actor.id},${old.body},${now})`;
      await tx`UPDATE forum_posts SET body=${body},updated_at=${now} WHERE id=${postId}`;
    });
  }
  async moderate(actor: ForumActor, kind: "thread" | "post", id: string, action: string) {
    if (!moderator(actor)) throw new ForumError("Moderator permission required.",403);
    await sqlTransaction(this.sql, async tx => {
      let rows;
      if (kind === "thread") {
        if (!["lock","unlock","pin","unpin","hide","unhide"].includes(action)) throw new ForumError("Invalid moderation action.");
        rows = await tx`UPDATE forum_threads SET locked=CASE WHEN ${action}='lock' THEN 1 WHEN ${action}='unlock' THEN 0 ELSE locked END, pinned=CASE WHEN ${action}='pin' THEN 1 WHEN ${action}='unpin' THEN 0 ELSE pinned END, hidden=CASE WHEN ${action}='hide' THEN 1 WHEN ${action}='unhide' THEN 0 ELSE hidden END WHERE id=${id} RETURNING id`;
      } else {
        if (!["hide","unhide"].includes(action)) throw new ForumError("Invalid moderation action.");
        rows = await tx`UPDATE forum_posts SET hidden=${action === "hide" ? 1 : 0} WHERE id=${id} RETURNING id`;
      }
      if (!rows.length) throw new ForumError("Content not found.",404);
      await tx`INSERT INTO forum_moderation (id,actor_id,target_type,target_id,action,detail,created_at) VALUES (${crypto.randomUUID()},${actor.id},${kind},${id},${action},'',${Date.now()})`;
    });
  }
  async setRole(actor: ForumActor, account: string, role: string) {
    if (actor.role !== "admin") throw new ForumError("Administrator permission required.",403);
    if (!["member","moderator","admin","banned"].includes(role)) throw new ForumError("Invalid forum role.");
    if (account === actor.id) throw new ForumError("Use another administrator to change your own role.");
    await sqlTransaction(this.sql, async tx => {
      const rows = await tx`UPDATE forum_profiles SET role=${role} WHERE account_id=${account} RETURNING account_id`;
      if (!rows.length) throw new ForumError("That account has not visited the forums yet.",404);
      await tx`INSERT INTO forum_moderation (id,actor_id,target_type,target_id,action,detail,created_at) VALUES (${crypto.randomUUID()},${actor.id},'profile',${account},'role',${role},${Date.now()})`;
    });
  }
  async profiles(): Promise<{account_id:string;name:string;role:ForumRole}[]> { return await this.sql`SELECT account_id,name,role FROM forum_profiles ORDER BY name LIMIT 500`; }
}
