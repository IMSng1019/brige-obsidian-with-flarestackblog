export interface TipTapDocument {
	type: 'doc';
	content?: Array<Record<string, unknown>>;
}

export interface ArticleRow {
	id: number;
	title: string;
	slug: string;
	content_json: string;
	revision: number;
	content_hash: string;
	obsidian_path: string | null;
	published: number;
	created_at: string;
	updated_at: string;
}

export interface Env {
	DB: D1Database;
	OBSIDIAN_SYNC_TOKEN: string;
	PUBLIC_SITE_URL: string;
}

export interface ArticlePayload {
	title: string;
	slug?: string;
	content: TipTapDocument;
	path?: string;
	published?: boolean;
}

export interface UpdatePayload extends ArticlePayload {
	revision: number;
	contentHash: string;
	force?: boolean;
}
