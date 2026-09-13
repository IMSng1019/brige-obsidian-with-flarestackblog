import type { TiptapDocument, TiptapMark, TiptapNode } from '../types';

function escapeText(value: string): string {
	return value.replace(/([\\`*_{}()[\]#+!|>~-])/g, '\\$1');
}

function markText(value: string, marks: TiptapMark[] | undefined): string {
	let result = value;
	for (const mark of [...(marks ?? [])].reverse()) {
		if (mark.type === 'bold') result = `**${result}**`;
		else if (mark.type === 'italic') result = `*${result}*`;
		else if (mark.type === 'strike') result = `~~${result}~~`;
		else if (mark.type === 'code') result = `\`${result.replace(/`/g, '\\`')}\``;
		else if (mark.type === 'link') {
			const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
			const title = typeof mark.attrs?.title === 'string' ? ` "${mark.attrs.title}"` : '';
			result = `[${result}](${href}${title})`;
		}
	}
	return result;
}

function inline(node: TiptapNode): string {
	if (node.type === 'text') return markText(escapeText(node.text ?? ''), node.marks);
	if (node.type === 'hardBreak') return '\n';
	if (node.type === 'image') {
		const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
		const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
		const title = typeof node.attrs?.title === 'string' ? ` "${node.attrs.title}"` : '';
		return `![${alt}](${src}${title})`;
	}
	return (node.content ?? []).map(inline).join('');
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inlineHtml(node: TiptapNode): string {
	let result = node.type === 'text' ? escapeHtml(node.text ?? '') : node.type === 'hardBreak' ? '<br>' : node.type === 'image'
		? `<img src="${escapeHtml(typeof node.attrs?.src === 'string' ? node.attrs.src : '')}" alt="${escapeHtml(typeof node.attrs?.alt === 'string' ? node.attrs.alt : '')}">`
		: (node.content ?? []).map(inlineHtml).join('');
	for (const mark of [...(node.marks ?? [])].reverse()) {
		if (mark.type === 'bold') result = `<strong>${result}</strong>`;
		else if (mark.type === 'italic') result = `<em>${result}</em>`;
		else if (mark.type === 'strike') result = `<s>${result}</s>`;
		else if (mark.type === 'code') result = `<code>${result}</code>`;
		else if (mark.type === 'link') {
			const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
			const title = typeof mark.attrs?.title === 'string' ? ` title="${escapeHtml(mark.attrs.title)}"` : '';
			result = `<a href="${escapeHtml(href)}"${title}>${result}</a>`;
		}
	}
	return result;
}

function cellText(node: TiptapNode): string {
	return (node.content ?? []).map((child) => {
		if (child.type === 'paragraph') return (child.content ?? []).map(inline).join('');
		return block(child);
	}).join('\n').replace(/\r?\n/g, '<br>');
}

function cellHtml(node: TiptapNode): string {
	return (node.content ?? []).map((child) => child.type === 'paragraph' ? (child.content ?? []).map(inlineHtml).join('') : (child.content ?? []).map(inlineHtml).join('')).join('<br>');
}

function tableRows(node: TiptapNode): TiptapNode[] {
	return (node.content ?? []).filter((child) => child.type === 'tableRow');
}

function tableHasSpans(node: TiptapNode): boolean {
	return tableRows(node).some((row) => (row.content ?? []).some((cell) => Number(cell.attrs?.colspan ?? 1) > 1 || Number(cell.attrs?.rowspan ?? 1) > 1));
}

function gfmAlignment(cell: TiptapNode): string {
	const alignment = cell.attrs?.alignment;
	return alignment === 'left' ? ':---' : alignment === 'center' ? ':---:' : alignment === 'right' ? '---:' : '---';
}

function tableToGfm(node: TiptapNode): string {
	const rows = tableRows(node);
	if (rows.length === 0) return '';
	const width = Math.max(...rows.map((row) => row.content?.length ?? 0));
	const rowText = (row: TiptapNode): string => {
		const cells = row.content ?? [];
		return `| ${Array.from({ length: width }, (_, index) => cellText(cells[index] ?? { type: 'tableCell' })).join(' | ')} |`;
	};
	const headerCells = rows[0]?.content ?? [];
	const separators = Array.from({ length: width }, (_, index) => gfmAlignment(headerCells[index] ?? { type: 'tableHeader' }));
	return [rowText(rows[0] ?? { type: 'tableRow' }), `| ${separators.join(' | ')} |`, ...rows.slice(1).map(rowText)].join('\n');
}

function tableToHtml(node: TiptapNode): string {
	const rows = tableRows(node);
	const headerRows: TiptapNode[] = [];
	let bodyStart = 0;
	while (bodyStart < rows.length && (rows[bodyStart]?.content ?? []).length > 0 && (rows[bodyStart]?.content ?? []).every((cell) => cell.type === 'tableHeader')) {
		headerRows.push(rows[bodyStart] as TiptapNode);
		bodyStart += 1;
	}
	const renderRow = (row: TiptapNode): string => {
		const cells = (row.content ?? []).map((cell) => {
			const tag = cell.type === 'tableHeader' ? 'th' : 'td';
			const colspan = Number(cell.attrs?.colspan ?? 1) > 1 ? ` colspan="${Number(cell.attrs?.colspan)}"` : '';
			const rowspan = Number(cell.attrs?.rowspan ?? 1) > 1 ? ` rowspan="${Number(cell.attrs?.rowspan)}"` : '';
			return `<${tag}${colspan}${rowspan}>${cellHtml(cell)}</${tag}>`;
		});
		return `<tr>\n${cells.join('\n')}\n</tr>`;
	};
	const sections: string[] = ['<table>'];
	if (headerRows.length > 0) sections.push('<thead>', ...headerRows.map(renderRow), '</thead>');
	if (bodyStart < rows.length) sections.push('<tbody>', ...rows.slice(bodyStart).map(renderRow), '</tbody>');
	sections.push('</table>');
	return sections.join('\n');
}

function block(node: TiptapNode, depth = 0): string {
	const children = node.content ?? [];
	if (node.type === 'paragraph') return children.map(inline).join('');
	if (node.type === 'heading') {
		const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
		return `${'#'.repeat(level)} ${children.map(inline).join('')}`;
	}
	if (node.type === 'blockquote') return children.map((child) => block(child, depth)).join('\n').split('\n').map((line) => `> ${line}`).join('\n');
	if (node.type === 'bulletList') return children.map((child) => `- ${blockListItem(child, depth + 1)}`).join('\n');
	if (node.type === 'orderedList') return children.map((child, index) => `${index + 1}. ${blockListItem(child, depth + 1)}`).join('\n');
	if (node.type === 'taskList') return children.map((child) => {
		const checked = nodeChecked(child) ? 'x' : ' ';
		return `- [${checked}] ${blockListItem(child, depth + 1)}`;
	}).join('\n');
	if (node.type === 'horizontalRule') return '---';
	if (node.type === 'codeBlock') {
		const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
		const code = children.map((child) => child.text ?? inline(child)).join('');
		return `\`\`\`${language}\n${code}\n\`\`\``;
	}
	if (node.type === 'table') return tableHasSpans(node) ? tableToHtml(node) : tableToGfm(node);
	if (node.type === 'image') return inline(node);
	if (children.length > 0) return children.map((child) => block(child, depth)).join('\n\n');
	return node.text ? escapeText(node.text) : '';
}

function nodeChecked(node: TiptapNode): boolean {
	return node.attrs?.checked === true;
}

function blockListItem(node: TiptapNode, depth: number): string {
	const paragraphs = node.content ?? [];
	return paragraphs.map((child) => block(child, depth)).join(' ');
}

export function tiptapToMarkdown(document: TiptapDocument): string {
	return (document.content ?? []).map((node) => block(node)).filter((value) => value.length > 0).join('\n\n');
}
