# Cloudflare Worker API

This Worker is a standalone reference implementation of the authenticated API used by the Obsidian plugin. It stores TipTap JSON in D1 and uses optimistic concurrency (`revision` plus SHA-256 `contentHash`). Set `OBSIDIAN_SYNC_TOKEN` with `wrangler secret put OBSIDIAN_SYNC_TOKEN`; never put the token in `wrangler.jsonc`.

The production `blogweb` repository already stores articles in `posts.contentJson` and runs Shiki highlighting in its post-processing workflow. For production, copy the route/auth/validation shape into `blogweb`, replace `worker/src/repository.ts` with an adapter around its posts service, and trigger the existing post-process workflow after create/update. The standalone table is useful for local API tests and demonstrations only.

Run `wrangler d1 migrations apply <database> --remote`, then `wrangler dev` from this directory. The plugin should point at the Worker URL (for example `https://blog.imsng.top` if the route is mounted on the blog domain, or a dedicated Worker URL otherwise).
