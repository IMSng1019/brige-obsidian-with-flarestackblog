import { requestUrl } from 'obsidian';
import type {
	AdminPost,
	AdminPostListPage,
	ApiErrorPayload,
	CreatePostInput,
	UpdatePostInput,
} from '../types';
import { buildListPostsQuery } from './query';

export class BlogApiError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, payload: ApiErrorPayload | undefined) {
		super(payload?.message ?? `Blog API request failed (${status})`);
		this.name = 'BlogApiError';
		this.status = status;
		this.code = payload?.code ?? 'REQUEST_FAILED';
	}
}

export interface BlogApiClientOptions {
	baseUrl: string;
	apiKey: string;
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, '');
}

export class BlogApiClient {
	private readonly baseUrl: string;
	private readonly apiKey: string;

	constructor(options: BlogApiClientOptions) {
		this.baseUrl = normalizeBaseUrl(options.baseUrl);
		this.apiKey = options.apiKey.trim();
		if (!this.baseUrl) throw new Error('Blog API URL is required');
		if (!this.apiKey) throw new Error('Blog API key is required');
	}

	private async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
		const response = await requestUrl({
			url: `${this.baseUrl}${path}`,
			method,
			headers: {
				'x-api-key': this.apiKey,
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

	listPosts(options: { offset?: number; limit?: number } = {}): Promise<AdminPostListPage> {
		return this.request<AdminPostListPage>('GET', `/api/admin/posts?${buildListPostsQuery(options)}`);
	}

	getPost(id: number): Promise<AdminPost> {
		return this.request<AdminPost>('GET', `/api/admin/posts/${encodeURIComponent(String(id))}`);
	}

	createPost(input: CreatePostInput): Promise<{ id: number }> {
		return this.request<{ id: number }>('POST', '/api/admin/posts', { data: input });
	}

	updatePost(id: number, input: UpdatePostInput): Promise<AdminPost> {
		return this.request<AdminPost>('PATCH', `/api/admin/posts/${encodeURIComponent(String(id))}`, { data: input });
	}

	async publishPost(id: number): Promise<void> {
		await this.request('POST', `/api/admin/posts/${encodeURIComponent(String(id))}/publish`);
	}

	async unpublishPost(id: number): Promise<void> {
		await this.request('POST', `/api/admin/posts/${encodeURIComponent(String(id))}/unpublish`);
	}

	async deletePost(id: number): Promise<void> {
		await this.request('DELETE', `/api/admin/posts/${encodeURIComponent(String(id))}`);
	}
}
