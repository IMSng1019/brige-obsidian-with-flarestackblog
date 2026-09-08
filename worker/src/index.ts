import { authenticate } from './auth';
import { contentHash, createArticle, deleteArticle, getArticle, listArticles, updateArticle } from './repository';
import type { Env } from './types';
import { jsonError, parseJson, validateArticlePayload, validateUpdatePayload } from './validation';

function articleResponse(env: Env, article: Awaited<ReturnType<typeof getArticle>>): Record<string, unknown> {
	if (!article) return {};
	return { id: article.id, title: article.title, slug: article.slug, content: article.content, revision: article.revision, contentHash: article.contentHash, updatedAt: article.updatedAt, createdAt: article.createdAt, published: article.published, url: `${env.PUBLIC_SITE_URL.replace(/\/+$/, '')}/post/${article.slug}`, ...(article.path ? { obsidianUri: `obsidian://open?file=${encodeURIComponent(article.path)}` } : {}) };
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
		const authError = authenticate(request, env);
		if (authError) return authError;
		const url = new URL(request.url);
		const base = '/api/obsidian/articles';
		if (url.pathname === base && request.method === 'GET') {
			const cursor = Math.max(0, Number(url.searchParams.get('cursor') ?? 0) || 0);
			const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100));
			const page = await listArticles(env, cursor, limit);
			return Response.json({ ...page, items: page.items.map((article) => articleResponse(env, article)) });
		}
		if (url.pathname === base && request.method === 'POST') {
			const parsed = await parseJson<unknown>(request);
			if (parsed instanceof Response) return parsed;
			const input = validateArticlePayload(parsed);
			if (input instanceof Response) return input;
			const article = await createArticle(env, input);
			return Response.json(articleResponse(env, article), { status: 201 });
		}
		const match = url.pathname.match(new RegExp(`^${base}/(\\d+)$`));
		if (!match) return jsonError('NOT_FOUND', 'Route not found', 404);
		const id = Number(match[1]);
		if (request.method === 'GET') {
			const article = await getArticle(env, id);
			return article ? Response.json(articleResponse(env, article)) : jsonError('ARTICLE_NOT_FOUND', 'Article not found', 404);
		}
		if (request.method === 'PUT') {
			const parsed = await parseJson<unknown>(request);
			if (parsed instanceof Response) return parsed;
			const input = validateUpdatePayload(parsed);
			if (input instanceof Response) return input;
			const result = await updateArticle(env, id, input);
			if (result.article) return Response.json(articleResponse(env, result.article));
			if (result.conflict) return jsonError('REVISION_CONFLICT', 'The remote article changed since this note was last synced', 409, articleResponse(env, result.conflict));
			return jsonError('ARTICLE_NOT_FOUND', 'Article not found', 404);
		}
		if (request.method === 'DELETE') return (await deleteArticle(env, id)) ? Response.json({ success: true }) : jsonError('ARTICLE_NOT_FOUND', 'Article not found', 404);
		return jsonError('METHOD_NOT_ALLOWED', 'Method not allowed', 405);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		try {
			return await handleRequest(request, env);
		} catch {
			return jsonError('INTERNAL_ERROR', 'The sync service could not complete the request', 500);
		}
	},
};

export { contentHash };
