# Grand Exchange and hiscores previews

These are website previews backed by deliberately contrived data. The game Grand
Exchange is not implemented, and neither page reads character files. Every page
labels sample prices/ranks so they cannot be mistaken for live game data.

## Grand Exchange

`/grand-exchange` searches a small sample catalogue; item pages at
`/grand-exchange/items/1333` reuse the original 2010 item-database template,
item images, market-price panel, legend and 30/90/180-day navigation assets.
The generated graph preserves the original brown grid and yellow daily-average /
blue trailing-30-day-average series. Its SVG includes dates and coin values.
Each range can also be downloaded as CSV. Six sample items have 210 deterministic
daily records; the extra 30 days support a complete rolling average for the
180-day chart. These values are not historical RuneScape prices.

`PriceHistorySource` in `src/exchange.ts` is the replacement boundary for a future
GE price-history database or service. It supplies item metadata and dated daily
prices. Future ingestion, trade aggregation, retention, permissions and real
minimum/maximum guide-price rules belong to the later GE implementation. The
current display's +/-5% sample guide range is illustrative.

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

Focused tests exercise GE range selection, deterministic history, chart/CSV
output, item search, missing items and original-template integration; hiscores
tests cover profile/rank consistency, skill/name/rank searches, pagination,
escaping, missing profiles and original-template rendering. Browser review uses
the supplied original archive, with no reference assets committed or bundled in
the image. These checks do not claim pixel equality at every viewport.
