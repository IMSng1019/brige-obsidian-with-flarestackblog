# Wiring the Worker into blogweb

The standalone Worker in `worker/` uses an `obsidian_articles` table so it can run by itself. The production site already has a `posts` table and post processing workflows, so the route should be mounted in the `blogweb` Worker and use the existing service layer.

Use the following mapping when replacing `worker/src/repository.ts`:

| Sync field | blogweb field | Notes |
| --- | --- | --- |
| `id` | `posts.id` | Keep the existing numeric post ID in frontmatter. |
| `title` | `posts.title` | Use the existing title validation. |
| `slug` | `posts.slug` | Call the existing slug generator for collisions. |
| `content` | `posts.contentJson` | Store the TipTap JSON directly. |
| `published` | `posts.status` | Map `true` to `published` and `false` to `draft`. |
| `revision` and `contentHash` | `obsidian_post_links` | Add a small D1 link table keyed by `post_id`; `post_revisions` can also be used for audit history. |
| `path` | `obsidian_post_links.obsidian_path` | Store the vault-relative Markdown path. |

The adapter should call `PostService.updatePost` (or the repository equivalent) and enqueue `PostProcessWorkflow` after content or publication status changes. That workflow is where `publicContentJson` and Shiki highlighted HTML are generated. Do not generate or accept `highlightedHtml` from the plugin.

The route must run behind the existing Hono app and use a secret bearer token. Keep `OBSIDIAN_SYNC_TOKEN` in a Cloudflare secret, validate the request body with the same Zod schemas used by the posts feature, and return the `REVISION_CONFLICT` payload without mutating `posts` when the link-table revision or hash is stale.

Suggested migration for the link metadata:

```sql
CREATE TABLE IF NOT EXISTS obsidian_post_links (
  post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  obsidian_path TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```
