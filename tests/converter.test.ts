import assert from 'node:assert/strict';
import test from 'node:test';
import {
	markdownToTiptap,
	tiptapToMarkdown,
} from '../src/converter/index.ts';

test('converts supported Markdown blocks to TipTap JSON', () => {
	const document = markdownToTiptap(
		'# Hello\n\nA **bold** and *italic* [link](https://example.com).\n\n- one\n- [x] done\n\n```ts\nconst answer = 42;\n```',
	);

	assert.deepEqual(document, {
		type: 'doc',
		content: [
			{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hello' }] },
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'A ' },
					{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
					{ type: 'text', text: ' and ' },
					{ type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
					{ type: 'text', text: ' ' },
					{
						type: 'text',
						text: 'link',
						marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
					},
					{ type: 'text', text: '.' },
				],
			},
			{
				type: 'bulletList',
				content: [
					{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
				],
			},
			{
				type: 'taskList',
				content: [
					{
						type: 'taskItem',
						attrs: { checked: true },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }],
					},
				],
			},
			{ type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const answer = 42;' }] },
		],
	});
});

test('serializes TipTap JSON to stable Markdown', () => {
	const markdown = tiptapToMarkdown({
		type: 'doc',
		content: [
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
			{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] },
			{ type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] }] },
			{ type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'A' } },
		],
	});

	assert.equal(markdown, '## Title\n\n> quoted\n\n1. first\n\n![A](https://example.com/a.png)');
});

test('round trips code language and inline marks', () => {
	const source = 'Text with `code`.\n\n```javascript\nconsole.log("ok");\n```';
	const result = tiptapToMarkdown(markdownToTiptap(source));
	assert.equal(result, source);
});

test('converts GFM tables with alignment and inline cell content', () => {
	const document = markdownToTiptap(
		'| Name | Score |\n| :--- | ---: |\n| **Alice** | 42 |\n| Bob | |',
	);

	assert.deepEqual(document.content[0], {
		type: 'table',
		content: [
			{
				type: 'tableRow',
				content: [
					{ type: 'tableHeader', attrs: { alignment: 'left' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }] },
					{ type: 'tableHeader', attrs: { alignment: 'right' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Score' }] }] },
				],
			},
			{
				type: 'tableRow',
				content: [
					{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alice', marks: [{ type: 'bold' }] }] }] },
					{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '42' }] }] },
				],
			},
			{
				type: 'tableRow',
				content: [
					{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bob' }] }] },
					{ type: 'tableCell', content: [{ type: 'paragraph' }] },
				],
			},
		],
	});
});

test('serializes simple TipTap tables as GFM', () => {
	const markdown = tiptapToMarkdown({
		type: 'doc',
		content: [{
			type: 'table',
			content: [
				{ type: 'tableRow', content: [
					{ type: 'tableHeader', attrs: { alignment: 'center' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }] },
					{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Value' }] }] },
				] },
				{ type: 'tableRow', content: [
					{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A | B' }] }] },
					{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
				] },
			],
		}],
	});

	assert.equal(markdown, '| Name | Value |\n| :---: | --- |\n| A \\| B | 1 |');
});

test('round trips merged cells through HTML tables', () => {
	const source = '<table>\n<thead><tr><th colspan="2">Header</th></tr></thead>\n<tbody><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></tbody>\n</table>';
	const document = markdownToTiptap(source);

	assert.deepEqual(document.content[0], {
		type: 'table',
		content: [
			{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Header' }] }] }] },
			{ type: 'tableRow', content: [
				{ type: 'tableCell', attrs: { rowspan: 2 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
				{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
			] },
			{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'C' }] }] }] },
		],
	});

	assert.equal(tiptapToMarkdown(document), '<table>\n<thead>\n<tr>\n<th colspan="2">Header</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td rowspan="2">A</td>\n<td>B</td>\n</tr>\n<tr>\n<td>C</td>\n</tr>\n</tbody>\n</table>');
});
