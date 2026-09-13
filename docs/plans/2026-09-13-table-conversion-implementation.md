# Table Conversion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve GFM and merged-cell tables across Obsidian Markdown and TipTap article synchronization.

**Architecture:** Extend the existing Markdown block parser with GFM and supported HTML table parsing. Extend the TipTap block serializer with table rendering that chooses GFM for simple tables and HTML for tables carrying `rowspan` or `colspan`; keep synchronization and API layers unchanged.

**Tech Stack:** TypeScript, Node test runner via `tsx`, esbuild, Obsidian TipTap JSON shapes.

---

### Task 1: Add failing converter tests

**Files:**
- Modify: `tests/converter.test.ts`

**Step 1: Write the failing tests**

Add focused tests for GFM header/data parsing, inline cell marks, alignment markers, uneven rows, simple table serialization, and HTML merged-cell round trips.

**Step 2: Run the focused tests**

Run: `npm test -- tests/converter.test.ts`

Expected: FAIL because the converter currently treats table lines as ordinary paragraphs and does not serialize table nodes.

### Task 2: Implement Markdown table parsing

**Files:**
- Modify: `src/converter/markdown-to-tiptap.ts`

**Step 1: Add table helpers**

Implement pipe-cell splitting that respects escaped pipes and backslash escapes, separator validation with optional alignment markers, row normalization, and TipTap table node construction. Parse supported HTML tables with DOM-independent tag scanning, preserving `rowspan` and `colspan` attributes and feeding cell inner text through `parseInline`.

**Step 2: Integrate block detection**

Before list/paragraph fallback, detect a valid GFM header plus separator and consume all contiguous table rows. Detect supported `<table>...</table>` blocks and consume them as a table node. Leave malformed candidates as ordinary paragraphs.

**Step 3: Run focused tests**

Run: `npm test -- tests/converter.test.ts`

Expected: parsing tests pass; serialization tests remain failing until Task 3.

### Task 3: Implement TipTap table serialization

**Files:**
- Modify: `src/converter/tiptap-to-markdown.ts`

**Step 1: Add table serializers**

Render simple tables as escaped, padded GFM rows with a header separator and optional alignment markers. Render tables with merge attributes as escaped HTML table markup, including `rowspan` and `colspan`, while preserving inline marks in cell content.

**Step 2: Integrate table block handling**

Add `table` dispatch in `block()` and preserve nested block spacing through the existing document join behavior.

**Step 3: Run focused tests**

Run: `npm test -- tests/converter.test.ts`

Expected: all converter tests pass.

### Task 4: Verify the plugin

**Files:**
- Modify: `docs/api/obsidian-sync.md` if supported conversion documentation needs updating.

**Step 1: Run the full test suite**

Run: `npm test`

Expected: all tests pass.

**Step 2: Run type checking and lint**

Run: `npm run build` and `npm run lint`

Expected: both exit successfully without new errors.

**Step 3: Inspect the diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only intended source, test, and documentation files are changed.

**Step 4: Commit**

```bash
git add src/converter/markdown-to-tiptap.ts src/converter/tiptap-to-markdown.ts tests/converter.test.ts docs/api/obsidian-sync.md docs/plans/2026-09-13-table-conversion-design.md docs/plans/2026-09-13-table-conversion-implementation.md
git commit -m "fix: preserve tables during blog sync"
```
