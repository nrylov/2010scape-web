# Native site pages and phone layouts

The captured 2010 pages are served as part of 2010scape, without public URLs
containing an archive prefix or an original source domain. The reference tree
stays unchanged under ignored `local/` and remains a read-only runtime mount.

## Routing

`src/site-routes.ts` supplies public URL namespaces. `ArchiveSite` builds an
in-memory index from captured HTML files and preserves distinct pages when
case/punctuation normalization would otherwise collide. Public paths include:

- `/downloads-and-wallpapers`, `/game-guide`, `/help` and `/parents-guide`.
- `/guide/<page-name>` for individual game-guide pages.
- `/news/history/...`, `/devblog/history/...`, `/forums/history/...` and
  `/grand-exchange/history/...` for captured historical pages. Live application
  lists and posts retain their existing URLs and take precedence.
- `/de/...`, `/fr/...`, `/pt/...` for captured language variants.
- `/extras/<section>/...` for other captured companion-site pages.
- `/assets/site/...`, `/assets/services/...` and the other declared asset
  namespaces for CSS, images and fonts.

Legacy `/archive/<original-host>/<path>` requests redirect with HTTP 308 to their
native destinations. Hash links remain intact; legacy redirect query strings
are retained. Relative/cross-host HTML links, CSS imports, CSS image URLs,
application-generated icons and legacy image/link URLs in saved Markdown use
native paths. Saved posts do not need a database migration.

Directory traversal, source-host allowlisting, sensitive-path exclusions,
symlink containment and file-extension restrictions remain enforced. Original
tracking/scripts/applets and obsolete forms remain disabled; native URLs do not
turn historical account/payment services into working 2010scape services.

Run `bun scripts/audit-native-routes.ts` against an extracted reference tree.
The current inventory contains 13,530 unique reachable native page routes. The
representative-page audit checks 345 linked destinations with no server errors
or emitted archive links. Ten linked destinations remain unavailable because
they were not captured or are original binary/service endpoints: the Portuguese
landing page, launcher binaries, uncaptured translated forums, membership,
quest-help, Adventurer's Log and redirect endpoints. These were unavailable
before the URL change; no content was fabricated to replace them.

## Responsive layouts

Desktop source styles remain intact. Additive rules at the mobile breakpoints
resize containers, wrap downloads navigation and content, constrain decorative
guide-image frames, stack hiscores panels and arrange skills in a compact grid.
Wide data tables scroll within their own region where needed. Forum content,
forms, headings and breadcrumb backgrounds fit narrow widths. Long plaque
headings use an ellipsis to preserve their original one-line artwork; article
body headings retain the full title.

An isolated browser harness rendered 16 representative pages with in-memory
posts at frame widths of 320, 390 and 600 pixels: 48 checks, with no document-wide
horizontal overflow or missing images. Browser screenshot review covered the
original desktop layout and phone-sized guide, downloads, post and hiscores
layouts. This is responsive-layout verification, not physical-device testing
or a pixel comparison of every captured page.
