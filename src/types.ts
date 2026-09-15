export interface TiptapMark {
	type: string;
	attrs?: Record<string, unknown>;
}

export interface TiptapNode {
	type?: string;
	attrs?: Record<string, unknown>;
	content?: TiptapNode[];
	marks?: TiptapMark[];
	text?: string;
}

export interface TiptapDocument extends TiptapNode {
	type: 'doc';
	content: TiptapNode[];
}

export type PostStatus = 'draft' | 'published';

/**
 * Editing-state post returned by `GET /api/admin/posts/{id}` and by
 * `GET /api/admin/posts?includeContent=true` items.
 */
export interface AdminPost {
	id: number;
	title: string;
	summary: string | null;
	slug: string;
	status: PostStatus;
	contentJson: TiptapDocument | null;
	publishedAt: string | null;
	pinnedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

/** One item of `GET /api/admin/posts?includeContent=true`. */
export type AdminPostListItem = AdminPost;

export interface AdminPostListPage {
	items: AdminPostListItem[];
	total: number;
	statusCounts: { draft: number; published: number };
}

/** Payload of `POST /api/admin/posts`; a request without `data` keeps the get-or-create behavior. */
export interface CreatePostInput {
	title: string;
	summary?: string | null;
	contentJson?: TiptapDocument | null;
}

/** Payload of `PATCH /api/admin/posts/{id}`; every field is optional. */
export interface UpdatePostInput {
	title?: string;
	summary?: string | null;
	contentJson?: TiptapDocument | null;
}

/**
 * Sync bookkeeping written into the note frontmatter. `contentHash` describes
 * the website copy at the last sync and `localHash` the local note, so the
 * plugin can tell which side changed without relying on a server version.
 */
export interface SyncMetadata {
	title?: string;
	articleId?: number;
	slug?: string;
	url?: string;
	contentHash?: string;
	localHash?: string;
	updatedAt?: string;
	obsidianUri?: string;
}

/** A website post paired with the TipTap document the plugin converts. */
export interface BlogArticle {
	id: number;
	title: string;
	slug: string;
	content: TiptapDocument;
	published: boolean;
	updatedAt: string;
	url: string;
}

/** oRPC error envelope returned by the blog API. */
export interface ApiErrorPayload {
	defined?: boolean;
	code?: string;
	status?: number;
	message?: string;
	data?: { current?: unknown };
}

export type ConflictStrategy = 'local' | 'remote' | 'manual';
