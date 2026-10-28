import type { ArchiveSite } from "./archive";

export interface HiscoreSkill {
  id: number;
  key: string;
  name: string;
  icon: string;
}

/** Revision-623 skill order and hiscore table numbers, including Dungeoneering. */
export const HISCORE_SKILLS: readonly HiscoreSkill[] = [
  { id: 0, key: "overall", name: "Overall", icon: "overall" },
  { id: 1, key: "attack", name: "Attack", icon: "attack" },
  { id: 2, key: "defence", name: "Defence", icon: "defence" },
  { id: 3, key: "strength", name: "Strength", icon: "strength" },
  { id: 4, key: "constitution", name: "Constitution", icon: "constitution" },
  { id: 5, key: "ranged", name: "Ranged", icon: "ranged" },
  { id: 6, key: "prayer", name: "Prayer", icon: "prayer" },
  { id: 7, key: "magic", name: "Magic", icon: "magic" },
  { id: 8, key: "cooking", name: "Cooking", icon: "cooking" },
  { id: 9, key: "woodcutting", name: "Woodcutting", icon: "woodcutting" },
  { id: 10, key: "fletching", name: "Fletching", icon: "fletching" },
  { id: 11, key: "fishing", name: "Fishing", icon: "fishing" },
  { id: 12, key: "firemaking", name: "Firemaking", icon: "firemaking" },
  { id: 13, key: "crafting", name: "Crafting", icon: "crafting" },
  { id: 14, key: "smithing", name: "Smithing", icon: "smithing" },
  { id: 15, key: "mining", name: "Mining", icon: "mining" },
  { id: 16, key: "herblore", name: "Herblore", icon: "herblore" },
  { id: 17, key: "agility", name: "Agility", icon: "agility" },
  { id: 18, key: "thieving", name: "Thieving", icon: "thieving" },
  { id: 19, key: "slayer", name: "Slayer", icon: "slayer" },
  { id: 20, key: "farming", name: "Farming", icon: "farming" },
  { id: 21, key: "runecrafting", name: "Runecrafting", icon: "runecraft" },
  { id: 22, key: "hunter", name: "Hunter", icon: "hunter" },
  { id: 23, key: "construction", name: "Construction", icon: "construction" },
  { id: 24, key: "summoning", name: "Summoning", icon: "summoning" },
  { id: 25, key: "dungeoneering", name: "Dungeoneering", icon: "dungeoneering" },
];

export interface HiscoreRank {
  rank: number;
  name: string;
  level: number;
  experience: number;
}
export interface HiscorePlayerSkill extends HiscoreRank { skill: HiscoreSkill; }
export interface HiscorePlayer {
  name: string;
  totalLevel: number;
  totalExperience: number;
  skills: HiscorePlayerSkill[];
}
export interface HiscoresProvider {
  /** Shown on every page so synthetic data cannot be mistaken for live ranks. */
  readonly dataLabel: string;
  leaderboard(skill: HiscoreSkill, page: number, pageSize: number): Promise<{ rows: HiscoreRank[]; total: number }>;
  player(name: string): Promise<HiscorePlayer | undefined>;
}

const PAGE_SIZE = 20;
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const number = (value: number) => Number(value).toLocaleString("en-US");

const SAMPLE_NAMES = Array.from({ length: 60 }, (_, index) => `Sample${String(index + 1).padStart(2, "0")}`);
const skillRankForPlayer = (skill: HiscoreSkill, playerIndex: number) => 1 + ((playerIndex * 7 + skill.id * 3) % SAMPLE_NAMES.length);
const playerIndexForSkillRank = (skill: HiscoreSkill, rank: number) => (((rank - 1 - skill.id * 3 + SAMPLE_NAMES.length * 10) % SAMPLE_NAMES.length) * 43) % SAMPLE_NAMES.length;
const skillRank = (skill: HiscoreSkill, rank: number): HiscorePlayerSkill => {
  const playerIndex = playerIndexForSkillRank(skill, rank);
  const ceiling = skill.key === "dungeoneering" ? 120 : 99;
  const level = Math.max(1, ceiling - Math.floor((rank - 1) / 3));
  return { rank, name: SAMPLE_NAMES[playerIndex]!, level, experience: Math.max(0, level * 1_250_000 - rank * 7_319), skill };
};
const playerStats = (playerIndex: number) => HISCORE_SKILLS.slice(1).map(skill => skillRank(skill, skillRankForPlayer(skill, playerIndex)));
const overallRanks = (): HiscoreRank[] => SAMPLE_NAMES.map((name, playerIndex) => {
  const skills = playerStats(playerIndex);
  return { name, level: skills.reduce((sum, row) => sum + row.level, 0), experience: skills.reduce((sum, row) => sum + row.experience, 0), rank: 0 };
}).sort((a, b) => b.level - a.level || b.experience - a.experience || a.name.localeCompare(b.name)).map((row, index) => ({ ...row, rank: index + 1 }));

/** Contrived local provider used until a real hiscores database is connected. */
export const sampleHiscores: HiscoresProvider = {
  dataLabel: "Illustrative sample ranks — not live player data",
  async leaderboard(skill, page, pageSize) {
    const allRows = skill.key === "overall" ? overallRanks() : Array.from({ length: SAMPLE_NAMES.length }, (_, index) => skillRank(skill, index + 1));
    const total = allRows.length, start = (page - 1) * pageSize;
    return { rows: allRows.slice(start, start + pageSize), total };
  },
  async player(name) {
    const canonical = name.toLowerCase();
    const playerIndex = SAMPLE_NAMES.findIndex(candidate => candidate.toLowerCase() === canonical);
    if (playerIndex < 0) return;
    const skills = playerStats(playerIndex);
    const overall = overallRanks().find(row => row.name === SAMPLE_NAMES[playerIndex]!)!;
    return { name: SAMPLE_NAMES[playerIndex]!, totalLevel: overall.level, totalExperience: overall.experience, skills };
  },
};

function selectedSkill(value: string | null) {
  return HISCORE_SKILLS.find(skill => skill.key === value?.toLowerCase() || String(skill.id) === value) ?? HISCORE_SKILLS[0]!;
}
function pageNumber(url: URL, total: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requestedRank = Number(url.searchParams.get("rank"));
  const requestedPage = Number(url.searchParams.get("page"));
  const raw = Number.isSafeInteger(requestedRank) && requestedRank > 0 ? Math.ceil(requestedRank / PAGE_SIZE) : requestedPage;
  return Math.max(1, Math.min(pages, Number.isSafeInteger(raw) && raw > 0 ? raw : 1));
}

function skillsMenu(active: HiscoreSkill) {
  return HISCORE_SKILLS.map(skill => `<li${skill.key === active.key ? ' style="background-color:#4c350a"' : ""}><a href="/hiscores?skill=${skill.key}" class="${skill.name} ico">${escape(skill.name)}</a></li>`).join("");
}
function navigation(name?: string) {
  return `<b>Location: </b> <a href="/">Home</a> &gt; <a href="/hiscores">Hiscores</a>${name ? ` &gt; ${escape(name)}` : ""}`;
}
function pager(skill: HiscoreSkill, page: number, pages: number) {
  const href = (n: number) => `/hiscores?skill=${encodeURIComponent(skill.key)}&amp;page=${n}`;
  return `<div class="arrow_header"></div><div class="arrow_back"><div class="buttons_arrows">${page > 1 ? `<a id="button-up" href="${href(page - 1)}"><span class="lev1_arrow"></span>U</a>` : ""}${page < pages ? `<a id="button-down" href="${href(page + 1)}"><span class="lev1_arrow"></span>D</a>` : ""}</div></div><div class="hiscores-pagination-label" style="clear:both;text-align:center">Page ${page} of ${pages}</div>`;
}
function leaderboardPane(skill: HiscoreSkill, rows: HiscoreRank[], total: number, page: number, label: string) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return `<div id="scores_head" class="subsectionHeader" style="padding:0"><img style="margin-top:3px" class="miniimg_list" src="/archive/www.runescape.com/img/hiscores/skill_icon_${skill.icon}1eccb.gif" alt="${escape(skill.name)} icon"> ${escape(skill.name)} Hiscores</div><p class="hiscores-data-note">${escape(label)}</p><table class="table_back"><thead><tr class="table_header"><th class="rankHead">Rank</th><th class="nameHead">Name</th><th class="levelHead">Level</th><th class="xpHead">XP</th></tr></thead><tbody>${rows.map((row, index) => `<tr class="row row${index + 1}"${index === rows.length - 1 ? ' id="lastRow"' : ""}><td class="rankCol">${number(row.rank)}</td><td class="alL"><a href="/hiscores/player/${encodeURIComponent(row.name)}">${escape(row.name)}</a></td><td class="alL">${number(row.level)}</td><td class="alL">${number(row.experience)}</td></tr>`).join("") || '<tr class="row row1"><td colspan="4">No ranked players are available.</td></tr>'}</tbody></table>${pager(skill, page, pages)}`;
}
function playerPane(player: HiscorePlayer | undefined, label: string) {
  if (!player) return `<div id="scores_head" class="subsectionHeader">Player not found</div><p>${escape(label)}</p><p>No ranked profile matches that name.</p>`;
  return `<div id="scores_head" class="subsectionHeader" style="padding:0"><img style="margin-top:3px" class="miniimg_list" src="/archive/www.runescape.com/img/hiscores/skill_icon_overall1eccb.gif" alt="Overall icon"> ${escape(player.name)} Hiscores</div><p class="hiscores-data-note">${escape(label)}</p><p>Overall level: ${number(player.totalLevel)} &nbsp; Overall XP: ${number(player.totalExperience)}</p><table class="table_back"><thead><tr class="table_header"><th class="rankHead">Rank</th><th class="nameHead">Skill</th><th class="levelHead">Level</th><th class="xpHead">XP</th></tr></thead><tbody>${player.skills.map((row, index) => `<tr class="row row${index + 1}"${index === player.skills.length - 1 ? ' id="lastRow"' : ""}><td class="rankCol">${number(row.rank)}</td><td class="alL">${escape(row.skill.name)}</td><td class="alL">${number(row.level)}</td><td class="alL">${number(row.experience)}</td></tr>`).join("")}</tbody></table>`;
}
function searchPane(skill: HiscoreSkill) {
  return `<div class="subsectionHeader search_title">Search by Name</div><div class="search_small"><form action="/hiscores/player" method="get" class="no_margin"><input id="search_name" class="textinput text" maxlength="12" type="text" name="user1" value=""><input type="submit" name="submit" class="buttonmedium" value="Search"></form></div><div class="subsectionHeader search_title">Search by rank</div><div class="search_small"><form action="/hiscores" method="get" class="no_margin"><input id="search_rank" class="textinput text" maxlength="12" type="number" min="1" name="rank" value=""><input type="hidden" name="skill" value="${escape(skill.key)}"><input type="submit" name="submit" class="buttonmedium" value="Search"></form></div><div class="subsectionHeader search_title">Compare Users</div><div class="search_large"><p>Compare profiles from the hiscores.</p></div><div class="subsectionHeader search_title">Friends Hiscores</div><div class="search_large" id="friends_search"><div class="friendsContent">Friends hiscores are not available in this preview.</div></div>`;
}

/** Render the original archived 2010 Hiscores shell with provider-backed rows. */
export async function handleHiscores(request: Request, archive: Pick<ArchiveSite, "template"> | undefined, provider: HiscoresProvider = sampleHiscores): Promise<Response | undefined> {
  const url = new URL(request.url), path = url.pathname;
  const isIndex = path === "/hiscores" || path === "/hiscores/";
  const isPlayerSearch = path === "/hiscores/player";
  const playerMatch = /^\/hiscores\/player\/(.+)$/.exec(path);
  if (!isIndex && !isPlayerSearch && !playerMatch) return;
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  let playerName: string | undefined;
  if (playerMatch) {
    try { playerName = decodeURIComponent(playerMatch[1]!); } catch { return new Response("Not found", { status: 404 }); }
  } else if (isPlayerSearch) playerName = url.searchParams.get("user1") ?? "";
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; script-src 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
  if (playerName !== undefined && !/^[a-z0-9 _]{1,12}$/i.test(playerName)) return new Response("Not found", { status: 404, headers });
  const template = await archive?.template("services.runescape.com", "m=hiscore/hiscores.html");
  if (!template) return new Response("Hiscores archive template is unavailable.", { status: 503, headers });
  const skill = selectedSkill(url.searchParams.get("skill"));
  const firstPage = playerName === undefined ? await provider.leaderboard(skill, 1, PAGE_SIZE) : undefined;
  const total = firstPage?.total ?? 0;
  const page = pageNumber(url, total);
  const rows = playerName === undefined ? (page === 1 ? firstPage!.rows : (await provider.leaderboard(skill, page, PAGE_SIZE)).rows) : [];
  const player = playerName === undefined ? undefined : await provider.player(playerName);
  const title = playerName === undefined ? `${skill.name} Hiscores` : `Hiscores for ${playerName}`;
  const content = await new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(`${title} - 2010scape`, { html: true }); } })
    .on(".navigation .location", { element(e) { e.setInnerContent(navigation(playerName), { html: true }); } })
    .on("h1.plaque", { element(e) { e.setInnerContent("RuneScape Hiscores", { html: true }); } })
    .on("#skillsList ul", { element(e) { e.setInnerContent(skillsMenu(skill), { html: true }); } })
    .on("#modeSelect_back .buttons", { element(e) { e.setInnerContent('<a id="button-left" href="/hiscores"><span class="lev1a"></span>Skills</a>', { html: true }); } })
    .on("#playerList_back", { element(e) { e.setInnerContent(playerName === undefined ? leaderboardPane(skill, rows, total, page, provider.dataLabel) : playerPane(player, provider.dataLabel), { html: true }); } })
    .on("#search_back", { element(e) { e.setInnerContent(searchPane(skill), { html: true }); } })
    .on("#footer .jagexlink img", { element(e) { e.setAttribute("src", "/archive/www.runescape.com/img/main/layout/jagexc20a.png"); } })
    .transform(new Response(template)).text();
  return new Response(request.method === "HEAD" ? null : content, { status: playerName !== undefined && !player ? 404 : 200, headers });
}
