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
