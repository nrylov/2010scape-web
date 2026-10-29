import { describe, expect, test } from "bun:test";
import type { ArchiveSite } from "../src/archive";
import { handleHiscores, HISCORE_SKILLS, sampleHiscores, type HiscoresProvider } from "../src/hiscores";

const template = `<!doctype html><html><head><title>Old Hiscores</title></head><body><div class="navigation"><div class="location">Old location</div></div><h1 class="plaque">RuneScape Hiscores</h1><div id="hiscores_background"><div id="skillsList_back"><div id="skillsList"><ul><li>Old skill</li></ul></div></div><div id="modeSelect_back"><div class="buttons">Old tabs</div></div><div id="playerList_back"><div id="scores_head">Old rows</div><table class="table_back"></table></div><div id="search_back">Old search</div></div><div id="footer"><a class="jagexlink"><img src="/assets/site/img/main/layout/jagex.png"></a></div></body></html>`;
const archive = { async template(host: string, path: string) { expect(host).toBe("services.runescape.com"); expect(path).toBe("m=hiscore/hiscores.html"); return template; } } as Pick<ArchiveSite, "template">;
const request = (path: string, method = "GET") => new Request("http://localhost" + path, { method });
const fixture: HiscoresProvider = {
  dataLabel: "Illustrative sample ranks — not live player data",
  async leaderboard(skill, page, pageSize) {
    const rows = Array.from({ length: 25 }, (_, index) => ({ rank: index + 1, name: `Sample${index + 1}`, level: 99 - index, experience: 1_000_000 - index * 1000 }));
    return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
  },
  async player(name) {
    if (name.toLowerCase() !== "samplehero") return;
    return { name: "SampleHero", totalLevel: 1700, totalExperience: 123456789, skills: HISCORE_SKILLS.slice(1).map((skill, index) => ({ skill, rank: index + 1, name: "SampleHero", level: 99 - index, experience: 1_000_000 - index * 1000 })) };
  },
};

describe("original 2010 Hiscores", () => {
  test("serves all revision-623 skills, selected-skill ranks and paginated sample data in the archived shell", async () => {
    const response = await handleHiscores(request("/hiscores?skill=attack"), archive, fixture);
    expect(response?.status).toBe(200);
    const html = await response!.text();
    expect(html).toContain("<title>Attack Hiscores - 2010scape</title>");
    expect(html).toContain('class="Attack ico"');
    expect(html).toContain('class="Dungeoneering ico"');
    expect(html.match(/class="[^"]+ ico"/g)).toHaveLength(26); // Overall plus all 25 skills
    expect(html).toContain("Illustrative sample ranks — not live player data");
    expect(html).toContain('href="/hiscores/player/Sample1"');
    expect(html).toContain('id="button-down" href="/hiscores?skill=attack&amp;page=2"');
    expect(html).toContain('<div class="hiscores-pagination-label" style="clear:both;text-align:center">Page 1 of 2</div>');
    expect(html).toContain('src="/assets/site/img/main/layout/jagexc20a.png"');
    expect(html).not.toContain('src="/assets/site/img/main/layout/jagex.png"');
    expect(html).not.toContain("Old rows");
    expect(html).toContain('class="table_back"');
  });

  test("search by name renders an escaped player profile with every skill", async () => {
    const response = await handleHiscores(request("/hiscores/player/SampleHero"), archive, fixture);
    expect(response?.status).toBe(200);
    const html = await response!.text();
    expect(html).toContain("Hiscores for SampleHero");
    expect(html).toContain("Overall level: 1,700");
    expect(html).toContain("Runecrafting");
    expect(html).toContain("Dungeoneering");
    expect(html).toContain("Illustrative sample ranks — not live player data");
    expect((await handleHiscores(request("/hiscores/player/MissingName"), archive, fixture))?.status).toBe(404);
    expect(await (await handleHiscores(request("/hiscores/player/MissingName"), archive, fixture))!.text()).toContain("No ranked profile matches that name.");
  });

  test("rank search, bounds, method handling and unrelated paths", async () => {
    const response = await handleHiscores(request("/hiscores?rank=25"), archive, fixture);
    const html = await response!.text();
    expect(html).toContain("Sample25");
    expect(html).toContain("Page 2 of 2");
    expect(html).toContain('name="skill" value="overall"');
    const filtered = await handleHiscores(request("/hiscores?skill=attack&rank=25"), archive, fixture);
    expect(await filtered!.text()).toContain('name="skill" value="attack"');
    expect((await handleHiscores(request("/hiscores", "POST"), archive, fixture))?.status).toBe(405);
    expect(await handleHiscores(request("/forums"), archive, fixture)).toBeUndefined();
    expect((await handleHiscores(request("/hiscores/player/%3Cscript%3E"), archive, fixture))?.status).toBe(404);
  });

  test("sample player profiles match their overall and per-skill leaderboard entries", async () => {
    const overall = await sampleHiscores.leaderboard(HISCORE_SKILLS[0]!, 1, 60);
    for (const row of overall.rows) {
      const player = await sampleHiscores.player(row.name);
      expect(player).toBeDefined();
      expect([player!.totalLevel, player!.totalExperience]).toEqual([row.level, row.experience]);
      for (const skillRow of player!.skills) {
        const board = await sampleHiscores.leaderboard(skillRow.skill, 1, 60);
        expect(board.rows.find(candidate => candidate.rank === skillRow.rank)).toMatchObject({
          name: player!.name, level: skillRow.level, experience: skillRow.experience,
        });
      }
    }
    const response = await handleHiscores(request("/hiscores"), archive);
    expect(response?.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; script-src 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  });
});
