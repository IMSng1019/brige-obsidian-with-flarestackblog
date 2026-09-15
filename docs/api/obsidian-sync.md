# Generic Admin API used by the plugin

The plugin authenticates with an Admin API key in the `x-api-key` header and uses only the blog's existing `/api/admin/posts` routes. Any external editor (script, agent, desktop client) can use the same contract.

## Calls

| Plugin action | Request |
| --- | --- |
| Create as website article | `POST /api/admin/posts` `{ "data": { "title", "contentJson" } }` → `{ id }`, then `GET /api/admin/posts/{id}` for the canonical body and slug |
| Upload linked article | `GET /api/admin/posts/{id}` (compare hashes) → `PATCH /api/admin/posts/{id}` `{ "data": { "title", "contentJson" } }` |
| Publish / unpublish | `POST /api/admin/posts/{id}/publish`, `POST /api/admin/posts/{id}/unpublish` |
| Download website article | `GET /api/admin/posts/{id}` |
| Sync whole folder | `GET /api/admin/posts?includeContent=true&sortBy=id&sortDir=ASC&limit=50&offset=N` until `offset >= total` |
| Delete | `DELETE /api/admin/posts/{id}` |

A post is `{ id, title, summary, slug, status, contentJson, publishedAt, pinnedAt, createdAt, updatedAt }`. `contentJson` is the editable TipTap document, including for drafts; it is `null` for an empty body and the plugin then works with `{ "type": "doc", "content": [] }`.

Errors use the oRPC envelope: `{ defined, code, status, message, data }`.

## Why `sortBy=id`

The default list order is `updatedAt DESC`, which is both second-precision and mutated by every write — including the writes a full sync performs. Paging by `offset` over that order can skip or repeat articles. `id` is the immutable primary key, so `sortBy=id&sortDir=ASC` makes offset paging stable. The plugin also asks for `includeContent=true` so a full sync is one request per 50 articles instead of one per article.

## Conflict detection without a server precondition

`PATCH /api/admin/posts/{id}` has no `If-Match`/`expectedVersion`, so the plugin keeps two SHA-256 hashes in the note frontmatter:

- `blog_content_hash` — the website body as the plugin last read it (`title` + `contentJson`);
- `blog_local_hash` — the local note body as the plugin last wrote or read it.

Before an upload the plugin re-reads the article, recomputes both hashes and decides between upload, download, a conflict dialog, or no action. The only race left is two writers inside the same request window; the dialog still protects the common case of a browser edit and a desktop edit.

## Supported conversion

The plugin converts headings, paragraphs, bold/italic/strike/code marks, links, images, blockquotes, ordered and unordered lists, task items, horizontal rules, fenced code blocks with language metadata, and GFM tables. TipTap tables with `rowspan` or `colspan` are downloaded as HTML tables so merged cells survive a round trip; simple tables remain GFM. Unknown TipTap nodes are serialized as their text descendants. Images are referenced by URL; uploading vault attachments requires a separate media API and is not silently attempted.
