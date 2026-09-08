import { requestUrl } from 'obsidian';
import type {
	ApiErrorPayload,
	ArticleListResponse,
	BlogArticle,
	CreateArticleInput,
	UpdateArticleInput,
} from './types';

export class BlogApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly current?: BlogArticle;

	constructor(status: number, payload: ApiErrorPayload | undefined) {
		super(payload?.error.message ?? `Blog API request failed (${status})`);
		this.name = 'BlogApiError';
		this.status = status;
		this.code = payload?.error.code ?? 'REQUEST_FAILED';
		this.current = payload?.error.current;
	}
}

export interface BlogApiClientOptions {
	baseUrl: string;
	token: string;
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, '');
}

export class BlogApiClient {
	private readonly baseUrl: string;
	private readonly token: string;

	constructor(options: BlogApiClientOptions) {
		this.baseUrl = normalizeBaseUrl(options.baseUrl);
		this.token = options.token.trim();
		if (!this.baseUrl) throw new Error('Blog API URL is required');
		if (!this.token) throw new Error('Blog API token is required');
	}

	private async request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
		const response = await requestUrl({
			url: `${this.baseUrl}${path}`,
			method,
			headers: {
				Authorization: `Bearer ${this.token}`,
				Accept: 'application/json',
				...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			throw: false,
		});
		let payload: unknown;
		try {
			payload = response.json;
		} catch {
			payload = undefined;
		}
		if (response.status < 200 || response.status >= 300) {
			throw new BlogApiError(response.status, payload as ApiErrorPayload | undefined);
		}
		return payload as T;
	}

	listArticles(cursor?: number, limit = 100): Promise<ArticleListResponse> {
		const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, limit))) });
		if (cursor !== undefined) params.set('cursor', String(cursor));
		return this.request<ArticleListResponse>('GET', `/api/obsidian/articles?${params.toString()}`);
	}

	getArticle(id: number): Promise<BlogArticle> {
		return this.request<BlogArticle>('GET', `/api/obsidian/articles/${encodeURIComponent(String(id))}`);
	}

	createArticle(input: CreateArticleInput): Promise<BlogArticle> {
		return this.request<BlogArticle>('POST', '/api/obsidian/articles', input);
	}

	updateArticle(id: number, input: UpdateArticleInput): Promise<BlogArticle> {
		return this.request<BlogArticle>('PUT', `/api/obsidian/articles/${encodeURIComponent(String(id))}`, input);
	}

	deleteArticle(id: number): Promise<{ success: true }> {
		return this.request<{ success: true }>('DELETE', `/api/obsidian/articles/${encodeURIComponent(String(id))}`);
	}
}
