import type { SyncMetadata } from '../types';

const FRONTMATTER_KEYS: Record<keyof SyncMetadata, string> = {
	title: 'blog_title',
	articleId: 'blog_id',
	slug: 'blog_slug',
	url: 'blog_url',
	revision: 'blog_revision',
	contentHash: 'blog_content_hash',
	updatedAt: 'blog_updated_at',
	obsidianUri: 'blog_obsidian_uri',
	localHash: 'blog_local_hash',
};

const REVERSE_KEYS = Object.fromEntries(Object.entries(FRONTMATTER_KEYS).map(([key, value]) => [value, key as keyof SyncMetadata])) as Record<string, keyof SyncMetadata>;

function parseScalar(value: string): string | number | boolean | undefined {
	const trimmed = value.trim();
	if (trimmed === '' || trimmed === 'null' || trimmed === '~') return undefined;
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1).replace(/\\([\\"'])/g, '$1');
	if (trimmed === 'true') return true;
	if (trimmed === 'false') return false;
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
	return trimmed;
}

export function splitFrontmatter(source: string): { lines: string[]; body: string; hasFrontmatter: boolean; newline: string } {
	const newline = source.includes('\r\n') ? '\r\n' : '\n';
	const normalized = source.replace(/\r\n?/g, '\n');
	if (!normalized.startsWith('---\n')) return { lines: [], body: source, hasFrontmatter: false, newline };
	const end = normalized.indexOf('\n---', 4);
	if (end < 0) return { lines: [], body: source, hasFrontmatter: false, newline };
	const closingEnd = normalized.indexOf('\n', end + 4);
	const frontmatter = normalized.slice(4, end);
	const body = closingEnd < 0 ? '' : normalized.slice(closingEnd + 1);
	return { lines: frontmatter.split('\n'), body, hasFrontmatter: true, newline };
}

export function readNoteBody(source: string): string {
	return splitFrontmatter(source).body;
}

export function replaceNoteBody(source: string, body: string): string {
	const parsed = splitFrontmatter(source);
	if (!parsed.hasFrontmatter) return body;
	const frontmatter = ['---', ...parsed.lines, '---'].join(parsed.newline);
	const normalizedBody = body.replace(/\r\n?/g, parsed.newline);
	return `${frontmatter}${parsed.newline}${parsed.newline}${normalizedBody}`;
}

export function readSyncMetadata(source: string): SyncMetadata {
	const { lines } = splitFrontmatter(source);
	const result: SyncMetadata = {};
	for (const line of lines) {
		const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!match) continue;
		const field = REVERSE_KEYS[match[1] ?? ''];
		if (!field) continue;
		const value = parseScalar(match[2] ?? '');
		if (value === undefined) continue;
		if (field === 'articleId' || field === 'revision') {
			if (typeof value === 'number' && Number.isInteger(value)) result[field] = value;
		} else if (typeof value === 'string') {
			result[field] = value;
		}
	}
	return result;
}

function formatScalar(value: string | number): string {
	if (typeof value === 'number') return String(value);
	if (/^[A-Za-z0-9._:/-]+$/.test(value)) return value;
	return JSON.stringify(value);
}

export function writeSyncMetadata(source: string, metadata: Partial<SyncMetadata>): string {
	const parsed = splitFrontmatter(source);
	const values = new Map<string, string>();
	for (const [field, key] of Object.entries(FRONTMATTER_KEYS) as Array<[keyof SyncMetadata, string]>) {
		const value = metadata[field];
		if (value !== undefined) values.set(key, formatScalar(value));
	}

	const existing = parsed.hasFrontmatter ? parsed.lines : [];
	const seen = new Set<string>();
	const outputLines: string[] = [];
	for (const line of existing) {
		const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		const key = match?.[1];
		if (!key || !(key in REVERSE_KEYS)) {
			outputLines.push(line);
			continue;
		}
		if (values.has(key)) {
			outputLines.push(`${key}: ${values.get(key)}`);
			seen.add(key);
		}
	}
	for (const [key, value] of values) {
		if (!seen.has(key)) outputLines.push(`${key}: ${value}`);
	}

	if (!parsed.hasFrontmatter) {
		const frontmatter = ['---', ...outputLines, '---'].join(parsed.newline);
		return `${frontmatter}${parsed.newline}${parsed.newline}${source}`;
	}
	const frontmatter = ['---', ...outputLines, '---'].join(parsed.newline);
	const body = parsed.body.replace(/\n/g, parsed.newline);
	return `${frontmatter}${parsed.newline}${body}`;
}
