# Server requirements for external editors

The plugin runs against a blog that implements the generic Admin API below. Nothing in this list is Obsidian-specific: any external editor needs the same three capabilities.

## Required

1. **Create with content** — `POST /api/admin/posts` accepts `{ "data": { "title", "contentJson" } }` and creates a *new* draft, generating a unique slug from the title and returning `{ id }`. Without `data` it keeps the get-or-create-empty-draft behavior the Admin UI relies on.
2. **List with bodies** — `GET /api/admin/posts?includeContent=true` returns `contentJson` on every item, keeping the existing pagination and the 50 item page limit.
3. **Stable order** — `sortBy=id` sorts by the immutable primary key (with `id` as the tiebreaker of the default order), so offset paging cannot skip or repeat rows while the client writes.

All three are optional additions: responses keep their previous shape unless the new parameter is sent.

## Not required

- No `/api/obsidian/*` routes: the plugin uses `/api/admin/posts` only.
- No dedicated bearer token: an Admin API key in `x-api-key` is enough, and it can be revoked per device.
- No link table: the post id, slug and content hashes live in the note frontmatter.
- No `obsidianUri` field: the `obsidian://` link is built locally from the vault name and path.

## Concurrency

The Admin API has no `ETag`, `If-Match` or version precondition, and `PATCH` writes unconditionally. The plugin therefore re-reads the article and compares content hashes before writing, and asks the user when both the website copy and the local note changed. See `obsidian-sync.md` for the exact rules.

If a future server version exposes a content version or supports `If-Match`, the plugin's client can send it in addition to the hash comparison without changing the frontmatter format.
