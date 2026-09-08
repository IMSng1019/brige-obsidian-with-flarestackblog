export interface TiptapMark {
	type: string;
	attrs?: Record<string, unknown>;
}

export interface TiptapNode {
	type: string;
	attrs?: Record<string, unknown>;
	content?: TiptapNode[];
	marks?: TiptapMark[];
	text?: string;
}

export interface TiptapDocument extends TiptapNode {
	type: 'doc';
	content: TiptapNode[];
}

export interface SyncMetadata {
	title?: string;
	articleId?: number;
	slug?: string;
	url?: string;
	revision?: number;
	contentHash?: string;
	updatedAt?: string;
	obsidianUri?: string;
	localHash?: string;
}

export interface BlogArticle {
	id: number;
	title: string;
	slug: string;
	content: TiptapDocument;
	revision: number;
	contentHash: string;
	updatedAt: string;
	url: string;
	obsidianUri?: string;
	published: boolean;
}

export interface CreateArticleInput {
	title: string;
	slug?: string;
	content: TiptapDocument;
	path?: string;
	published?: boolean;
}

export interface UpdateArticleInput {
	title: string;
	slug?: string;
	content: TiptapDocument;
	path?: string;
	published?: boolean;
	revision: number;
	contentHash: string;
	force?: boolean;
}

export interface ArticleListResponse {
	items: BlogArticle[];
	nextCursor: number | null;
}

export interface ApiErrorPayload {
	error: {
	code: string;
	message: string;
	current?: BlogArticle;
	requestId?: string;
	};
}

export type ConflictStrategy = 'local' | 'remote' | 'manual';
