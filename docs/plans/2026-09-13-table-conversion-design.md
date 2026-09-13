# Table Conversion Design

## Goal

Preserve Markdown tables when Obsidian notes are uploaded to and downloaded from the website, including TipTap table structure and merged-cell attributes.

## Scope

- Parse standard GFM tables into TipTap `table`, `tableRow`, `tableHeader`, and `tableCell` nodes.
- Serialize ordinary TipTap tables as stable GFM tables.
- Serialize tables containing `rowspan` or `colspan` as HTML tables so merged cells survive the round trip.
- Parse supported HTML table markup back into the same TipTap table nodes, preserving `rowspan` and `colspan`.
- Reuse the existing inline Markdown conversion inside cells and escape Markdown/HTML-sensitive cell text.
- Keep unsupported table attributes and unrelated synchronization behavior unchanged.

## Data flow

Upload continues through `markdownToTiptap`, so table recognition is added to the block parser before ordinary paragraph parsing. Download continues through `tiptapToMarkdown`; table nodes are rendered by a dedicated block serializer. The sync service and API contracts remain unchanged because tables are already represented as TipTap JSON content.

## Error handling

Malformed or incomplete table candidates remain readable paragraphs. Rows with fewer cells are padded with empty cells; extra cells expand the table width. Malformed HTML table fragments are treated as ordinary text rather than throwing. Missing merge attributes use normal single-cell defaults.

## Testing

Add converter tests that first fail for GFM table parsing and serialization, then cover inline formatting, alignment markers, uneven rows, merged-cell HTML round trips, and ordinary document round trips. Run the focused tests, the full test suite, TypeScript build, and lint before committing.
