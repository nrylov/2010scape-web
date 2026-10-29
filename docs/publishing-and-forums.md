# Publishing and forums

The visual authority is the supplied July 2010 RuneScape archive in ignored
`local/website-reference/2010-07-18/`. Live pages reuse its original HTML,
stylesheets, background art, parchment, borders, icons and footer. Do not
replace these with a newly drawn theme. The supplied
[2011Scape forum](https://2011.rs/services/m=forum/) is a supplementary reference
for board organization and interactions, rather than the source of 2010 art.

## Publishing

Sign in at `/admin` using the configured administrator password, choose Create
post, and select News announcement or Developer blog. Drafts are private;
Published posts appear in their respective lists and article pages. News also
appears on the homepage. Posts retain author, category, project, tags and an
optional list summary. Existing plain-text posts retain that format.

The editor provides Bold, Italic, Heading, Link, Picture, List and Preview
buttons. It edits Markdown source and renders a preview; it is not a WYSIWYG
editor. Pictures accept HTTPS URLs and local `/assets/...` paths (legacy archive paths are rewritten on render), including inline
images within a paragraph. File uploads are not implemented. Raw HTML is
escaped, and unsafe URL schemes cannot produce links or images. Validation
errors preserve unsaved article text and metadata.

News uses `m=news/list.html` and `newsitemc007.html` (or `newsitem13fe.html`);
developer blogs use `m=devblog/index.html` and `view_postfe29.html`. Formatting
inherits the original article styles. Responsive additions adapt narrow screens;
they are not a replacement for the original desktop layout.

## Forums and accounts

`/forums` provides boards, threads, replies, edit history, title search,
pagination, locking/pinning/hiding, forum roles, bans and a moderation audit log.
Its composer has the same formatting toolbar and authenticated safe preview.
The index, board and thread pages reuse `m=forum/forums.html`,
`sl=0/forums4454.html` and `sl=0/forums38a8.html` from the archive.

The single website administrator account signs in at `/admin/login`, using the
configured administrator password. That session can publish posts, create
threads/replies and moderate. Visitors can read and search the forum. There is
no public registration or game-account sign-in in this iteration.

The website does not read character files or depend on the game server for
identity. A future account database or external authentication service can
supply identities to the forum's injected authentication boundary. Keep that
work separate from this one-account publishing and forum iteration.

## Audit and verification (28 October 2026)

The audit found a disconnected forum module, duplicate forum navigation controls, invented letter avatars and
forced block/centered article images. These have been corrected. Original
assets remain untouched and outside Git/container images.

The publishing/forum check passed 29 tests, including administrator sessions posting through the main application router, safe previews, drafts, persistence, CSRF, moderation and original-template
integration. Browser checks exercised news and developer article rendering,
forum boards/threads, administrator login, and article/forum formatting previews.
This does not claim an automated pixel-by-pixel comparison or verification at
every mobile viewport. Saved article layouts use the actual reference files;
new editor and moderation controls are application additions.

Follow-up audit: the deployed blog index was empty because it had no published
developer posts; test articles had existed only in the isolated preview. The
original archive's filter is a form, not a div. Its live replacement now replaces
the entire inert archive form, avoiding disabled/nested forms, and retains the
original author/project/tag layout and Filter Posts image button. Regression
coverage includes filtering published posts and verifying a usable single form.
Website checks passed (40 local tests, including deferred uncommitted auth tests).
