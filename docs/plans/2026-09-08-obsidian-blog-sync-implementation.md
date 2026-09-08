# Obsidian Blog Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an Obsidian plugin and Cloudflare Worker API that synchronize selected Markdown notes with TipTap JSON blog articles using authenticated, revision-checked requests.

**Architecture:** Keep the Obsidian entry point small and split conversion, frontmatter metadata, API calls, synchronization, commands, and settings into focused modules. Put the Worker in `worker/` with an isolated D1 repository, bearer-token middleware, request validation, and optimistic concurrency. The plugin and Worker share a documented JSON contract but do not share runtime dependencies.

**Tech Stack:** TypeScript, Obsidian API, esbuild, Cloudflare Workers Fetch API, D1 SQLite, Vitest for pure unit tests where available.

---

### Task 1: Establish repository layout and shared protocol types

**Files:**
- Create: `src/types.ts`
- Create: `src/api/types.ts`
- Create: `worker/src/types.ts`
- Create: `worker/README.md`
- Create: `worker/migrations/0001_create_blog_articles.sql`

**Step 1: Write the failing type-level and serialization tests**

Add a small test suite under `tests/` using the repository's available TypeScript test runner (or a package script if one must be added) for article response parsing and D1 row serialization.

**Step 2: Run the focused tests and verify they fail**

Run the focused test command and confirm failures are caused by missing protocol helpers rather than environment setup.

**Step 3: Implement the protocol types and schema**

Define TipTap JSON content, article records, create/update payloads, paginated responses, conflict errors, link metadata, and plugin settings. Add a D1 table with integer IDs, title/slug, JSON content, revision, content hash, optional Obsidian path, published flag, timestamps, and a unique slug.

**Step 4: Run the focused tests again**

Confirm the protocol tests pass and malformed records are rejected.

### Task 2: Implement Markdown to TipTap conversion

**Files:**
- Create: `src/converter/markdown-to-tiptap.ts`
- Create: `src/converter/tiptap-to-markdown.ts`
- Create: `src/converter/index.ts`
- Test: `tests/converter.test.ts`

**Step 1: Write failing round-trip tests**

Cover headings, paragraphs, marks, links, images, blockquotes, ordered/unordered/task lists, rules, inline code, fenced code with language, blank lines, escaping, and empty documents.

**Step 2: Run tests and verify the converter is absent**

Run the focused test command and confirm the expected missing-module failures.

**Step 3: Implement a dependency-free deterministic converter**

Parse block Markdown line by line with a small state machine and parse inline marks/links without evaluating HTML. Serialize supported TipTap nodes back to Markdown, preserving code language and task checked state. Normalize output so content hashes do not change because of incidental whitespace.

**Step 4: Run tests and refactor only after green**

Run converter tests, then extract helpers for escaping and recursive node traversal while keeping behavior unchanged.

### Task 3: Implement frontmatter links and content hashing

**Files:**
- Create: `src/sync/frontmatter.ts`
- Create: `src/sync/hash.ts`
- Test: `tests/frontmatter.test.ts`

**Step 1: Write failing metadata tests**

Test reading existing YAML frontmatter, preserving unrelated keys, writing link metadata, removing only plugin-owned keys, handling quoted values, and hashing title plus normalized TipTap content.

**Step 2: Verify red**

Run the focused tests and confirm the helpers are not implemented.

**Step 3: Implement metadata helpers**

Use a conservative frontmatter parser that handles scalar strings, booleans, and numbers without rewriting the Markdown body. Reserve a namespaced `blogSync` object when possible, with a flat-key fallback that remains valid Obsidian YAML. Use Web Crypto SHA-256 and stable JSON serialization for content hashes.

**Step 4: Verify green**

Run metadata tests and inspect that body text and unrelated frontmatter remain byte-stable.

### Task 4: Implement the authenticated Worker API

**Files:**
- Create: `worker/src/repository.ts`
- Create: `worker/src/auth.ts`
- Create: `worker/src/validation.ts`
- Create: `worker/src/index.ts`
- Create: `worker/wrangler.jsonc`
- Create: `worker/package.json`
- Create: `worker/tests/api.test.ts`

**Step 1: Write failing Worker request tests**

Cover missing/invalid bearer tokens, list and get, create, conditional update, `409` stale revision, forced update, explicit delete, not-found handling, and JSON error shape.

**Step 2: Run tests and verify red**

Run Worker tests in a Cloudflare-compatible runner if available; otherwise run pure request tests against the exported handler and confirm missing route behavior.

**Step 3: Implement the Worker**

Route `/api/obsidian/articles` and `/api/obsidian/articles/:id`, authenticate with `OBSIDIAN_SYNC_TOKEN`, validate payload size and fields, calculate SHA-256 content hashes, and use parameterized D1 statements. Update only when revision and hash match unless `force` is true; increment revision atomically and return `409` with the current article on conflict. Build public URLs from `PUBLIC_SITE_URL` and `obsidian://open` links from the stored path.

**Step 4: Verify Worker tests**

Run the focused Worker tests, then run TypeScript checking for the Worker package.

### Task 5: Implement plugin API client and synchronization service

**Files:**
- Create: `src/api/client.ts`
- Create: `src/sync/sync-service.ts`
- Test: `tests/sync-service.test.ts`

**Step 1: Write failing service tests**

Cover create and frontmatter binding, linked-note update, no-op when the normalized hash is unchanged, remote-to-local folder import, and conflict classification.

**Step 2: Verify red**

Run the service tests and confirm they fail because the client/service modules are missing.

**Step 3: Implement client and service**

Use Obsidian's `requestUrl` for cross-origin requests, send bearer credentials, parse structured errors, and avoid logging tokens. The service converts note content, updates metadata, uses vault adapter reads/writes, creates safe filenames, matches remote articles by ID or slug, and exposes explicit download/force-upload methods.

**Step 4: Verify green**

Run service tests and check that conflict responses leave local files unchanged.

### Task 6: Add Obsidian commands, context menu actions, settings, and event sync

**Files:**
- Modify: `src/main.ts`
- Modify: `src/settings.ts`
- Create: `src/ui/conflict-modal.ts`
- Create: `src/commands.ts`
- Modify: `styles.css`
- Modify: `manifest.json`
- Modify: `versions.json`

**Step 1: Write failing command registration tests or compile assertions**

Verify command IDs are stable and the file-menu callback is registered for Markdown files.

**Step 2: Implement lifecycle and UI**

Add settings for API URL, bearer token, public site URL, sync folder, automatic sync, and publish-on-sync. Register commands for create, sync folder, upload, download, and force upload. Add a Markdown file-menu action for creation, debounce `modify` events, and register all events through Obsidian cleanup helpers. Show short notices and a conflict modal with download/force options.

**Step 3: Update release metadata**

Rename the sample plugin identity, set a stable plugin ID, describe the sync behavior, and keep `versions.json` aligned with `manifest.json`.

**Step 4: Verify compile and lint**

Run `npm.cmd run build` and `npm.cmd run lint` from the plugin root.

### Task 7: Document deployment and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `worker/README.md`
- Create: `docs/api/obsidian-sync.md`

**Step 1: Document setup**

Explain Worker secrets, D1 migration, plugin settings, supported Markdown subset, conflict behavior, and the fact that the existing blog repo needs the Worker route wired to its `posts` table or an adapter.

**Step 2: Run all checks**

Run plugin build/lint, Worker tests/typecheck, and the converter/service suites. Inspect generated output without committing `main.js`.

**Step 3: Record limitations**

Document unsupported custom TipTap nodes, image upload expectations, and the need to map the Worker repository to the blog's existing `posts` schema before production deployment.
