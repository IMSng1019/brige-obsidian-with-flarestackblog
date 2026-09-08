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
