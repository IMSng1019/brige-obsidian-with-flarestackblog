import type { ArticlePayload, TipTapDocument, UpdatePayload } from './types';

const MAX_BODY_BYTES = 1_000_000;

export function jsonError(code: string, message: string, status: number, current?: unknown): Response {
	return Response.json({ error: { code, message, ...(current === undefined ? {} : { current }) } }, { status });
}

export async function parseJson<T>(request: Request): Promise<T | Response> {
	const contentLength = Number(request.headers.get('Content-Length') ?? 0);
	if (contentLength > MAX_BODY_BYTES) return jsonError('PAYLOAD_TOO_LARGE', 'Request body is too large', 413);
	try {
		const text = await request.text();
		if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return jsonError('PAYLOAD_TOO_LARGE', 'Request body is too large', 413);
		return JSON.parse(text) as T;
	} catch {
		return jsonError('INVALID_JSON', 'Request body must be valid JSON', 400);
	}
}

function validDocument(content: TipTapDocument): boolean {
	return !!content && content.type === 'doc' && (content.content === undefined || Array.isArray(content.content));
}

export function validateArticlePayload(value: unknown): ArticlePayload | Response {
	if (!value || typeof value !== 'object') return jsonError('INVALID_PAYLOAD', 'Article payload must be an object', 400);
	const input = value as Partial<ArticlePayload>;
	if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 300) return jsonError('INVALID_TITLE', 'title is required and must be at most 300 characters', 400);
	if (!validDocument(input.content as TipTapDocument)) return jsonError('INVALID_CONTENT', 'content must be a TipTap document', 400);
	if (input.slug !== undefined && (typeof input.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug))) return jsonError('INVALID_SLUG', 'slug must contain lowercase letters, numbers and hyphens', 400);
	if (input.path !== undefined && (typeof input.path !== 'string' || input.path.length > 500)) return jsonError('INVALID_PATH', 'path must be at most 500 characters', 400);
	if (input.published !== undefined && typeof input.published !== 'boolean') return jsonError('INVALID_PUBLISHED', 'published must be a boolean', 400);
	return { title: input.title.trim(), slug: input.slug, content: input.content as TipTapDocument, path: input.path, published: input.published ?? false };
}

export function validateUpdatePayload(value: unknown): UpdatePayload | Response {
	const article = validateArticlePayload(value);
	if (article instanceof Response) return article;
	const input = value as Partial<UpdatePayload>;
	const revision = input.revision;
	if (!Number.isInteger(revision) || (revision ?? -1) < 0) return jsonError('INVALID_REVISION', 'revision must be a non-negative integer', 400);
	if (typeof input.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.contentHash)) return jsonError('INVALID_HASH', 'contentHash must be a SHA-256 hex string', 400);
	if (input.force !== undefined && typeof input.force !== 'boolean') return jsonError('INVALID_FORCE', 'force must be a boolean', 400);
	return { ...article, revision: revision as number, contentHash: input.contentHash, force: input.force ?? false };
}
