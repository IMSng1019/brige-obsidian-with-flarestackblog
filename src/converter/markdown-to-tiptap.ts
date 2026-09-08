import type { TiptapDocument, TiptapMark, TiptapNode } from '../types';

interface ParsedListItem {
	text: string;
	checked?: boolean;
}

const BLOCK_MARKER = /^(#{1,6})\s+(.*)$/;
const FENCE_MARKER = /^\s*(```+|~~~+)\s*([^\s]*)\s*$/;
const BULLET_MARKER = /^\s*[-*+]\s+(.*)$/;
const ORDERED_MARKER = /^\s*\d+[.)]\s+(.*)$/;
const TASK_MARKER = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;

function textNode(text: string, marks?: TiptapMark[]): TiptapNode {
	const node: TiptapNode = { type: 'text', text };
	if (marks && marks.length > 0) node.marks = marks;
	return node;
}

function findClosing(source: string, marker: string, start: number): number {
	return source.indexOf(marker, start);
}

function parseInline(source: string): TiptapNode[] {
	const nodes: TiptapNode[] = [];
	let buffer = '';

	const flush = () => {
		if (buffer.length > 0) {
			nodes.push(textNode(buffer));
			buffer = '';
		}
	};

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (character === '\\' && index + 1 < source.length && /[*_`~[\\]/.test(source[index + 1] ?? '')) {
			buffer += source[index + 1];
			index += 1;
			continue;
		}

		if (character === '`') {
			const end = findClosing(source, '`', index + 1);
			if (end > index + 1) {
				flush();
				nodes.push(textNode(source.slice(index + 1, end), [{ type: 'code' }]));
				index = end;
				continue;
			}
		}

		const imageMatch = source.slice(index).match(/^!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/);
		if (imageMatch) {
			flush();
			const image: TiptapNode = {
				type: 'image',
				attrs: { src: imageMatch[2], alt: imageMatch[1] ?? '' },
			};
			if (imageMatch[3]) image.attrs = { ...image.attrs, title: imageMatch[3] };
			nodes.push(image);
			index += imageMatch[0].length - 1;
			continue;
		}

		const linkMatch = source.slice(index).match(/^\[([^\]]+)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/);
		if (linkMatch) {
			flush();
			const attrs: Record<string, unknown> = { href: linkMatch[2] };
			if (linkMatch[3]) attrs.title = linkMatch[3];
			nodes.push(textNode(linkMatch[1] ?? '', [{ type: 'link', attrs }]));
			index += linkMatch[0].length - 1;
			continue;
		}

		let marker: string | undefined;
		let markType: string | undefined;
		if (source.startsWith('**', index) || source.startsWith('__', index)) {
			marker = source.slice(index, index + 2);
			markType = 'bold';
		} else if (source.startsWith('~~', index)) {
			marker = '~~';
			markType = 'strike';
		} else if (character === '*' || character === '_') {
			marker = character;
			markType = 'italic';
		}
		if (marker && markType) {
			const end = findClosing(source, marker, index + marker.length);
			if (end > index + marker.length) {
				flush();
				nodes.push(textNode(source.slice(index + marker.length, end), [{ type: markType }]));
				index = end + marker.length - 1;
				continue;
			}
		}

		buffer += character;
	}

	flush();
	return nodes;
}

function paragraph(text: string): TiptapNode {
	const content = parseInline(text);
	return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function listItem(item: ParsedListItem, task: boolean): TiptapNode {
	const node: TiptapNode = {
		type: task ? 'taskItem' : 'listItem',
		content: [paragraph(item.text)],
	};
	if (task) node.attrs = { checked: item.checked === true };
	return node;
}

function readList(lines: string[], start: number): { node: TiptapNode; next: number } | undefined {
	const first = lines[start] ?? '';
	const firstTask = first.match(TASK_MARKER);
	const firstOrdered = first.match(ORDERED_MARKER);
	const firstBullet = first.match(BULLET_MARKER);
	if (!firstTask && !firstOrdered && !firstBullet) return undefined;

	const task = firstTask !== null;
	const ordered = firstTask === null && firstOrdered !== null;
	const items: ParsedListItem[] = [];
	let index = start;
	while (index < lines.length) {
		const line = lines[index] ?? '';
		if (!task && TASK_MARKER.test(line)) break;
		const match = task ? line.match(TASK_MARKER) : ordered ? line.match(ORDERED_MARKER) : line.match(BULLET_MARKER);
		if (!match) break;
		if (task) items.push({ text: match[2] ?? '', checked: (match[1] ?? '').toLowerCase() === 'x' });
		else items.push({ text: match[1] ?? '' });
		index += 1;
	}

	return {
		node: {
			type: task ? 'taskList' : ordered ? 'orderedList' : 'bulletList',
			content: items.map((item) => listItem(item, task)),
		},
		next: index,
	};
}

function parseBlocks(markdown: string): TiptapNode[] {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	const blocks: TiptapNode[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? '';
		if (line.trim() === '') {
			index += 1;
			continue;
		}

		const fence = line.match(FENCE_MARKER);
		if (fence) {
			const language = fence[2] ?? '';
			const fenceToken = fence[1] ?? '```';
			index += 1;
			const codeLines: string[] = [];
			while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith(fenceToken)) {
				codeLines.push(lines[index] ?? '');
				index += 1;
			}
			if (index < lines.length) index += 1;
			const node: TiptapNode = { type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text: codeLines.join('\n') }] };
			blocks.push(node);
			continue;
		}

		const heading = line.match(BLOCK_MARKER);
		if (heading) {
			blocks.push({ type: 'heading', attrs: { level: heading[1]?.length ?? 1 }, content: parseInline(heading[2] ?? '') });
			index += 1;
			continue;
		}

		if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
			blocks.push({ type: 'horizontalRule' });
			index += 1;
			continue;
		}

		const list = readList(lines, index);
		if (list) {
			blocks.push(list.node);
			index = list.next;
			continue;
		}

		if (/^\s*>/.test(line)) {
			const quoteLines: string[] = [];
			while (index < lines.length && /^\s*>/.test(lines[index] ?? '')) {
				quoteLines.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
				index += 1;
			}
			blocks.push({ type: 'blockquote', content: parseBlocks(quoteLines.join('\n')) });
			continue;
		}

		const paragraphLines = [line];
		index += 1;
		while (index < lines.length) {
			const next = lines[index] ?? '';
			if (next.trim() === '' || FENCE_MARKER.test(next) || BLOCK_MARKER.test(next) || TASK_MARKER.test(next) || BULLET_MARKER.test(next) || ORDERED_MARKER.test(next) || /^\s*>/.test(next)) break;
			paragraphLines.push(next);
			index += 1;
		}
		blocks.push(paragraph(paragraphLines.join('\n')));
	}

	return blocks;
}

export function markdownToTiptap(markdown: string): TiptapDocument {
	return { type: 'doc', content: parseBlocks(markdown) };
}
