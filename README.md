# Blog Sync for Obsidian

Synchronize Obsidian Markdown notes with the TipTap articles used by `blog.imsng.top` through an authenticated Cloudflare Worker API.

## Setup

1. Deploy the reference Worker in `worker/`, or mount its route in the `blogweb` repository and adapt `worker/src/repository.ts` to the existing `posts` service. `blogweb` stores article content in `posts.contentJson`; its post processing workflow generates Shiki-highlighted `publicContentJson`.
2. Set the Worker secret with `wrangler secret put OBSIDIAN_SYNC_TOKEN` and apply the D1 migration. Keep the token out of source control.
3. In Obsidian open **Settings → Blog sync**, enter the Worker URL, the same token, and the public site URL. Choose a folder for imported articles.

The plugin adds **Create as website article**, **Upload linked article**, **Download website article**, and **Sync blog articles to folder** commands. Markdown file context menus contain create and upload actions. With automatic sync enabled, edits to a linked note are uploaded after a short debounce.

## Links and conflicts

Creating or downloading an article writes `blog_*` frontmatter keys containing the remote ID, slug, URL, revision, content hash, and an `obsidian://` link. Updates use the saved revision and hash. If the website changed first, the plugin leaves the note untouched and offers **Download website version** or **Force upload local version**.

## Supported format

The converter handles headings, paragraphs, bold/italic/strike/code marks, links, images, blockquotes, ordered/unordered/task lists, horizontal rules, and fenced code blocks with language names. Shiki highlighting remains a server-side concern. Vault attachments are not uploaded automatically; use public image URLs or add a separate media endpoint.

## Development

```bash
npm install
npm run build
npm run lint
npm test
```

The generated `main.js` is ignored by Git and is copied to the vault only for manual testing.
