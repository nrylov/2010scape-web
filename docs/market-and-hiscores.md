# Grand Exchange and hiscores

The Grand Exchange pages show live guide prices and completed-trade history
from the game world when `GAME_MARKET_URL` is set. Without it they fall back to
a clearly labeled sample catalogue. Hiscores remain a labeled preview. Neither
page reads character files.

## Grand Exchange

`/grand-exchange` searches the market by name and supports the original A–Z
browse links. Item pages at `/grand-exchange/items/453` reuse the original 2010
item-database template, market-price panel, legend and 30/90/180-day navigation
assets. Items with their own archived page (Rune scimitar, Logs, Coal, Lobster,
Air rune and Iron ore) keep its frame, image and examine text; other items use
the Rune scimitar page frame with its item content replaced. The graph keeps the
original brown grid and yellow daily-average / blue trailing-30-day-average
series, and each range can be downloaded as CSV (`date,daily_average,volume,source`).

### Live market (`GAME_MARKET_URL`)

`gameMarket()` in `src/exchange.ts` reads the game server's read-only, versioned
`/market` API (see the game repository's `docs/grand-exchange.md`):

| Website use | Game endpoint |
| --- | --- |
| Search and letter browse | `/market/items?query=…` |
| Guide, minimum and maximum price | `/market/items/{id}` |
| Graph, price changes, CSV | `/market/items/{id}/history?days=180` |

Set `GAME_MARKET_URL` to the game HTTP base URL, for example
`http://127.0.0.1:43595` locally or `http://2010scape-game:43595` inside the
cluster (the OrbStack renderer defaults to that). The website fetches
server-side with a two-second timeout and caches each response for 60 seconds;
browsers never contact the game. Unreachable, non-version-1 or malformed
responses produce a 503 "temporarily unavailable" page (logged as
`[grand-exchange] …`) rather than sample or invented prices. Unknown or
untradeable items are 404s.

- The market price and ±5% minimum/maximum are the game's guide values. The
  page says whether the guide comes from the latest completed trading day or is
  a starting seed because the item has not traded yet.
- History contains only observed UTC trading days. Ranges are calendar windows
  ending today (UTC), not row counts. Days without trades stay as gaps in the
  graph; a lone trading day is drawn as a dot. Nothing is interpolated.
- The blue line averages observed daily prices over the trailing 30 calendar
  days. The website requests at most 180 days, so the earliest points of the
  180-day chart average a partial window.
- Price changes compare the latest observed price with the latest observed
  price at least 30/90/180 days earlier, and show `n/a` when either is missing.
- The game search returns at most 100 matches; the page says so when it is
  truncated. Letter browsing searches for the letter and keeps names starting
  with it, so very common letters can miss items beyond those 100 matches.
- There is no item art for items without an archived page.

### Sample fallback

Without `GAME_MARKET_URL`, `samplePrices` serves six items with 210
deterministic daily records ending 2026-10-28, labeled as sample data on every
page. These values are not historical RuneScape prices.

## Hiscores

`/hiscores` reuses the original 2010 hiscores page, its skill icons, tables and
search controls. It supports Overall plus all 25 October 2010 skills including
Dungeoneering, name lookup, rank lookup, pagination and individual sample
profiles. Sample rows and profiles agree on ranks, levels, experience and totals.
Use a visible `SampleNN` name from the table to inspect a profile.

`HiscoresProvider` in `src/hiscores.ts` accepts a later database or external
service. Public accounts, live character ingestion, friends hiscores and profile
comparison are deferred. No game-save volume should be mounted into the website.

## Verification

Focused tests exercise GE range selection, deterministic sample history,
chart/CSV output, item search, missing items and original-template integration.
Live-market tests use a fake game API to cover guide sources, sparse calendar
windows, gap rendering, letter browsing, caching, 404s and 503s for unreachable,
unsupported or malformed responses; hiscores
tests cover profile/rank consistency, skill/name/rank searches, pagination,
escaping, missing profiles and original-template rendering. Browser review uses
the supplied original archive, with no reference assets committed or bundled in
the image. These checks do not claim pixel equality at every viewport.
