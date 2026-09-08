# Obsidian Blog Sync Design

## Goal

Add an Obsidian community plugin and a Cloudflare Worker API that keep selected Markdown notes synchronized with the TipTap JSON articles stored by the blog at `blog.imsng.top`.

## Confirmed decisions

- The synchronization payload is TipTap JSON. The Obsidian side converts Markdown to and from the supported TipTap document nodes.
- The Worker owns authentication, validation, optimistic concurrency, and persistence in Cloudflare D1. The blog frontend can consume the same article records.
- A note can be linked to an article through frontmatter metadata. The link stores the article ID, slug, URL, revision, content hash, and last sync timestamp. The Worker also returns an `obsidian://` link for the note when a path is supplied.
- Local edits are the default source of truth. A stale revision is treated as a conflict; the plugin does not overwrite the remote copy silently and offers download or force-upload actions.
- Article deletion is explicit. A local file deletion does not delete a remote article automatically.
- The initial converter supports headings, paragraphs, emphasis, strong, strike, links, images, blockquotes, ordered and unordered lists, task-list items, horizontal rules, fenced code blocks with language metadata, inline code, and plain text. Unsupported Markdown is preserved as readable text where possible.

## Architecture

The plugin is split into settings, API client, frontmatter/link metadata, Markdown/TipTap conversion, synchronization service, UI commands, and a small settings tab. `main.ts` only loads settings, registers commands/events, and delegates work. A file-modification listener schedules synchronization for linked notes and debounces repeated editor saves.

The Worker lives under `worker/` and exposes `/api/obsidian/articles` endpoints. A D1 repository isolates SQL from request handling. `POST` creates an article, `GET` lists or reads articles, `PUT` updates with an expected revision and content hash, and `DELETE` is available for an explicit remote deletion. The Worker uses a bearer token configured through a secret and returns structured JSON errors, including `409` conflicts.

## Data flow

1. Creating an article from a note converts the note to TipTap JSON, sends title/slug/content/path to the Worker, and writes the returned link metadata into the note frontmatter.
2. Folder synchronization lists remote articles, matches existing metadata by ID or slug, updates linked notes, and creates new Markdown notes for unlinked remote articles in the configured folder.
3. A linked note modification converts the current Markdown, compares the stored content hash, and sends a conditional `PUT`. On success the plugin updates revision/hash metadata. On conflict it presents the remote revision and leaves the local file untouched.
4. Downloading a remote article converts its TipTap JSON to Markdown and updates the note metadata. Force upload uses the current remote revision while replacing the remote content intentionally.

## API contract

- `GET /api/obsidian/articles?limit=100&cursor=...`
- `GET /api/obsidian/articles/:id`
- `POST /api/obsidian/articles` with `{ title, slug?, content, path?, published? }`
- `PUT /api/obsidian/articles/:id` with `{ title, slug?, content, path?, published?, revision, contentHash, force? }`
- `DELETE /api/obsidian/articles/:id`

Successful article responses include `id`, `title`, `slug`, `content`, `revision`, `contentHash`, `updatedAt`, `url`, and optional `obsidianUri`. The API accepts `Authorization: Bearer <token>` and validates JSON payloads and revision numbers.

## Error handling and privacy

The plugin operates locally except for configured Worker requests. It never sends vault contents without an explicit create, sync, or automatic update action for a linked note. Network errors surface as actionable notices. Secrets are stored using Obsidian plugin data storage and are never logged. The Worker rejects missing or invalid credentials, limits request sizes, and uses parameterized D1 queries.

## Verification

Unit tests cover the Markdown/TipTap converter, frontmatter metadata handling, API conflict responses, and Worker request routing. The repository build and lint commands remain the release gate; generated `main.js` is not committed.
