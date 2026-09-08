import type { ArticlePayload, ArticleRow, Env, UpdatePayload } from './types';

export interface StoredArticle {
	id: number;
	title: string;
	slug: string;
	content: Record<string, unknown>;
	revision: number;
	contentHash: string;
	path?: string;
	published: boolean;
	createdAt: string;
	updatedAt: string;
}

function parseContent(value: string): Record<string, unknown> {
	try { return JSON.parse(value) as Record<string, unknown>; } catch { return { type: 'doc', content: [] }; }
}

function toStored(row: ArticleRow): StoredArticle {
	return { id: row.id, title: row.title, slug: row.slug, content: parseContent(row.content_json), revision: row.revision, contentHash: row.content_hash, ...(row.obsidian_path ? { path: row.obsidian_path } : {}), published: row.published === 1, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function listArticles(env: Env, cursor: number, limit: number): Promise<{ items: StoredArticle[]; nextCursor: number | null }> {
	const rows = await env.DB.prepare('SELECT * FROM obsidian_articles WHERE id > ? ORDER BY id ASC LIMIT ?').bind(cursor, limit + 1).all<ArticleRow>();
	const items = rows.results.slice(0, limit).map(toStored);
	return { items, nextCursor: rows.results.length > limit ? (items.at(-1)?.id ?? null) : null };
}

export async function getArticle(env: Env, id: number): Promise<StoredArticle | undefined> {
	const row = await env.DB.prepare('SELECT * FROM obsidian_articles WHERE id = ?').bind(id).first<ArticleRow>();
	return row ? toStored(row) : undefined;
}

async function slugAvailable(env: Env, slug: string): Promise<boolean> {
	return (await env.DB.prepare('SELECT id FROM obsidian_articles WHERE slug = ?').bind(slug).first()) === null;
}

function slugify(value: string): string {
	return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-') || 'untitled';
}

async function uniqueSlug(env: Env, requested: string | undefined, title: string): Promise<string> {
	const base = slugify(requested ?? title);
	if (await slugAvailable(env, base)) return base;
	for (let suffix = 2; suffix < 1000; suffix += 1) if (await slugAvailable(env, `${base}-${suffix}`)) return `${base}-${suffix}`;
	return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

async function hashPayload(title: string, content: unknown): Promise<string> {
	const stable = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(stable);
		if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
		return value;
	};
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stable({ title: title.trim(), content }))));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createArticle(env: Env, input: ArticlePayload): Promise<StoredArticle> {
	const slug = await uniqueSlug(env, input.slug, input.title);
	const now = new Date().toISOString();
	const contentHash = await hashPayload(input.title, input.content);
	const result = await env.DB.prepare('INSERT INTO obsidian_articles (title, slug, content_json, revision, content_hash, obsidian_path, published, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?) RETURNING *').bind(input.title, slug, JSON.stringify(input.content), contentHash, input.path ?? null, input.published ? 1 : 0, now, now).first<ArticleRow>();
	if (!result) throw new Error('Article insert failed');
	return toStored(result);
}

export async function updateArticle(env: Env, id: number, input: UpdatePayload): Promise<{ article?: StoredArticle; conflict?: StoredArticle }> {
	const current = await getArticle(env, id);
	if (!current) return {};
	if (!input.force && (current.revision !== input.revision || current.contentHash !== input.contentHash)) return { conflict: current };
	const slug = input.slug && input.slug !== current.slug ? await uniqueSlug(env, input.slug, input.title) : current.slug;
	const now = new Date().toISOString();
	const nextRevision = current.revision + 1;
	const nextHash = await hashPayload(input.title, input.content);
	const result = await env.DB.prepare('UPDATE obsidian_articles SET title = ?, slug = ?, content_json = ?, revision = ?, content_hash = ?, obsidian_path = ?, published = ?, updated_at = ? WHERE id = ? AND revision = ? RETURNING *').bind(input.title, slug, JSON.stringify(input.content), nextRevision, nextHash, input.path ?? null, input.published ? 1 : 0, now, id, current.revision).first<ArticleRow>();
	return result ? { article: toStored(result) } : { conflict: (await getArticle(env, id)) };
}

export async function deleteArticle(env: Env, id: number): Promise<boolean> {
	const result = await env.DB.prepare('DELETE FROM obsidian_articles WHERE id = ?').bind(id).run();
	return result.meta.changes > 0;
}

export async function contentHash(title: string, content: unknown): Promise<string> { return hashPayload(title, content); }
