# Obsidian sync API

The plugin talks to a Cloudflare Worker using JSON and a bearer token. Configure the plugin's API URL to the Worker origin and store the same token in the Worker's `OBSIDIAN_SYNC_TOKEN` secret.

## Endpoints

`GET /api/obsidian/articles?limit=100&cursor=0` returns `{ items, nextCursor }`. `GET /api/obsidian/articles/:id` returns one article. `POST /api/obsidian/articles` creates a draft or published article. `PUT /api/obsidian/articles/:id` updates an article when `revision` and `contentHash` still match; set `force: true` only after reviewing a conflict. `DELETE /api/obsidian/articles/:id` explicitly removes an article.

Article JSON has `id`, `title`, `slug`, `content` (TipTap document), `revision`, `contentHash`, `updatedAt`, `published`, `url`, and optionally `obsidianUri`.

## Blogweb integration

The current `blogweb` repository has public read routes but no external mutation route. Its existing post table stores `contentJson`, and the post process workflow generates `publicContentJson` with Shiki highlighting. For production, mount the Worker route in `blogweb`, replace the standalone D1 repository with calls to the existing posts repository/service, and enqueue the existing post process workflow after create/update. Keep the bearer token in a Cloudflare secret and rotate it if it is exposed.

## Supported conversion

The plugin converts headings, paragraphs, bold/italic/strike/code marks, links, images, blockquotes, ordered and unordered lists, task items, horizontal rules, and fenced code blocks with language metadata. Unknown TipTap nodes are serialized as their text descendants. Images are referenced by URL; uploading vault attachments requires a separate media API and is not silently attempted.
