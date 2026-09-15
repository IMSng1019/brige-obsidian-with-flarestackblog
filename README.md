# Blog Sync for Obsidian

Synchronize Obsidian Markdown notes with the TipTap articles of a [flare-stack-blog](https://github.com/du2333/flare-stack-blog) site, such as `blog.imsng.top`.

The plugin only talks to the generic Admin HTTP API that already exists on the blog: an Admin API key in the `x-api-key` header plus the `/api/admin/posts` routes. There is no Obsidian-specific endpoint, token or database table on the server side.

## Server capabilities

| Capability | Route |
| --- | --- |
| Create a draft that already carries content | `POST /api/admin/posts` with `{ data: { title, contentJson } }` |
| Read one article with its TipTap body | `GET /api/admin/posts/{id}` |
| Update an article | `PATCH /api/admin/posts/{id}` with `{ data: { title, contentJson } }` |
| List every article with its body, ordered by id | `GET /api/admin/posts?includeContent=true&sortBy=id&sortDir=ASC&limit=50&offset=N` |
| Publish or unpublish | `POST /api/admin/posts/{id}/publish`, `POST /api/admin/posts/{id}/unpublish` |
| Delete | `DELETE /api/admin/posts/{id}` |

`includeContent` and `sortBy=id` are the two additions the plugin asked for upstream; both are optional and backwards compatible, so an unpatched blog still works for single-article sync.

## Setup

1. On your site open **Settings → API keys** and create an Admin API key (it starts with `fsb_`).
2. In Obsidian open **Settings → Blog sync** and enter the blog URL, the API key parsed above, and the public site URL. Choose a folder for imported articles.
3. The key is stored in the plugin's local data file and is only ever sent to the blog origin you configured.

The plugin adds **Create as website article**, **Upload linked article**, **Download website article**, and **Sync blog articles to folder** commands. Markdown file context menus contain create and upload actions. With automatic sync enabled, edits to a linked note are uploaded after a short debounce.

## Links and conflicts

Creating or downloading an article writes `blog_*` frontmatter keys containing the remote ID, slug, URL, the hash of the website body, the hash of the local body, the update timestamp and an `obsidian://` link.

Because the Admin API writes unconditionally, the plugin re-reads the article before every upload and compares the stored hash with the current website body:

| Website changed | Local note changed | What happens |
| --- | --- | --- |
| no | yes | upload |
| yes | no | download the website version into the note |
| yes | yes | a dialog offers **Download website version**, **Force upload local version** or **Cancel** |
| no | no | nothing to do |

**Force upload local version** keeps the article's current published state and overwrites the website body without further checks.

Publishing runs after the body was uploaded, so an already published article is published again to refresh the snapshot your site renders. When **Publish when syncing** is off and the article is currently published, the plugin unpublishes it instead.

## Supported format

The converter handles headings, paragraphs, bold/italic/strike/code marks, links, images, blockquotes, ordered/unordered/task lists, horizontal rules, fenced code blocks with language names, and GFM tables. TipTap tables with merged cells are downloaded as HTML tables so they survive a round trip. Shiki highlighting remains a server-side concern. Vault attachments are not uploaded automatically; use public image URLs or a separate media endpoint.

## Development

```bash
npm install
npm run build
npm run lint
npm test
```

The generated `main.js` is ignored by Git and is copied to the vault only for manual testing.
