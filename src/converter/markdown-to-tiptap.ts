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
const TABLE_SEPARATOR = /^:?-{3,}:?$/;

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

function splitTableCells(line: string): string[] {
	let value = line.trim();
	if (value.startsWith('|')) value = value.slice(1);
	if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);

	const cells: string[] = [];
	let current = '';
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index] ?? '';
		if (character === '\\' && value[index + 1] === '|') {
			current += '|';
			index += 1;
		} else if (character === '|') {
			cells.push(current.trim());
			current = '';
		} else {
			current += character;
		}
	}
	cells.push(current.trim());
	return cells;
}

function tableCell(content: string, type: 'tableHeader' | 'tableCell', attrs?: Record<string, unknown>): TiptapNode {
	const node: TiptapNode = { type, content: [paragraph(content)] };
	if (attrs && Object.keys(attrs).length > 0) node.attrs = attrs;
	return node;
}

function tableRow(cells: string[], type: 'tableHeader' | 'tableCell', attrsForCell?: (index: number) => Record<string, unknown> | undefined): TiptapNode {
	return {
		type: 'tableRow',
		content: cells.map((cell, index) => tableCell(cell, type, attrsForCell?.(index))),
	};
}

function parseTableAlignment(value: string): 'left' | 'center' | 'right' | undefined {
	const marker = value.trim();
	if (!TABLE_SEPARATOR.test(marker)) return undefined;
	if (marker.startsWith(':') && marker.endsWith(':')) return 'center';
	if (marker.startsWith(':')) return 'left';
	if (marker.endsWith(':')) return 'right';
	return undefined;
}

function parseGfmTable(lines: string[], start: number): { node: TiptapNode; next: number } | undefined {
	const headerLine = lines[start] ?? '';
	const separatorLine = lines[start + 1] ?? '';
	if (!headerLine.includes('|') || !separatorLine.includes('|')) return undefined;
	const headers = splitTableCells(headerLine);
	const separators = splitTableCells(separatorLine);
	if (headers.length === 0 || separators.length === 0 || separators.some((separator) => !TABLE_SEPARATOR.test(separator))) return undefined;

	const alignments = separators.map(parseTableAlignment);
	const rows: TiptapNode[] = [tableRow(headers, 'tableHeader', (index) => alignments[index] ? { alignment: alignments[index] } : undefined)];
	let index = start + 2;
	while (index < lines.length) {
		const line = lines[index] ?? '';
		if (line.trim() === '' || !line.includes('|')) break;
		const cells = splitTableCells(line);
		if (cells.length === 0) break;
		rows.push(tableRow(cells, 'tableCell'));
		index += 1;
	}

	const width = Math.max(...rows.map((row) => row.content?.length ?? 0));
	for (const row of rows) {
		while ((row.content?.length ?? 0) < width) row.content?.push(tableCell('', row === rows[0] ? 'tableHeader' : 'tableCell'));
	}
	return { node: { type: 'table', content: rows }, next: index };
}

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)));
}

function htmlCellToMarkdown(value: string): string {
	return decodeHtmlEntities(value
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
		.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
		.replace(/<(s|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~')
		.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
		.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
		.replace(/<[^>]+>/g, ''));
}

function htmlAttribute(attributes: string, name: string): number | undefined {
	const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)["']?`, 'i'));
	if (!match) return undefined;
	const value = Number.parseInt(match[1] ?? '', 10);
	return Number.isInteger(value) && value > 1 ? value : undefined;
}

function parseHtmlTable(source: string): TiptapNode | undefined {
	const rows: TiptapNode[] = [];
	const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
	let rowMatch: RegExpExecArray | null;
	while ((rowMatch = rowPattern.exec(source)) !== null) {
		const cells: TiptapNode[] = [];
		const cellPattern = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
		let cellMatch: RegExpExecArray | null;
		while ((cellMatch = cellPattern.exec(rowMatch[1] ?? '')) !== null) {
			const type = (cellMatch[1] ?? '').toLowerCase() === 'th' ? 'tableHeader' : 'tableCell';
			const attrs: Record<string, unknown> = {};
			const colspan = htmlAttribute(cellMatch[2] ?? '', 'colspan');
			const rowspan = htmlAttribute(cellMatch[2] ?? '', 'rowspan');
			if (colspan) attrs.colspan = colspan;
			if (rowspan) attrs.rowspan = rowspan;
			cells.push(tableCell(htmlCellToMarkdown(cellMatch[3] ?? ''), type, attrs));
		}
		if (cells.length > 0) rows.push({ type: 'tableRow', content: cells });
	}
	return rows.length > 0 ? { type: 'table', content: rows } : undefined;
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

		if (/^\s*<table\b/i.test(line)) {
			let end = index + 1;
			while (end < lines.length && !/<\/table\s*>/i.test(lines[end] ?? '')) end += 1;
			if (end < lines.length) {
				const table = parseHtmlTable(lines.slice(index, end + 1).join('\n'));
				if (table) {
					blocks.push(table);
					index = end + 1;
					continue;
				}
			}
		}

		const table = parseGfmTable(lines, index);
		if (table) {
			blocks.push(table.node);
			index = table.next;
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
