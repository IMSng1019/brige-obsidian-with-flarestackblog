import type { BlogArticle, TiptapDocument } from '../types';

export const EMPTY_DOCUMENT: TiptapDocument = { type: 'doc', content: [] };

/** The Admin API returns `null` for a post that has no body yet. */
export function documentOf(contentJson: TiptapDocument | null | undefined): TiptapDocument {
	return contentJson ?? EMPTY_DOCUMENT;
}

export type SyncAction = 'conflict' | 'download' | 'upload' | 'noop';

/**
 * Decides what an upload should do. The plugin stores the hash of the website
 * copy it last read (`contentHash`) and of the local note (`localHash`), so it
 * can re-read the post before writing and only ask the user when both sides
 * changed. There is no server-side precondition, so this check is what keeps an
 * external editor from silently overwriting a newer website revision.
 */
export function planSyncAction(state: { force: boolean; localChanged: boolean; remoteChanged: boolean }): SyncAction {
	if (state.force) return 'upload';
	if (state.localChanged && state.remoteChanged) return 'conflict';
	if (state.remoteChanged) return 'download';
	if (state.localChanged) return 'upload';
	return 'noop';
}

/** Raised when the website copy changed while the local note was edited too. */
export class BlogConflictError extends Error {
	readonly current: BlogArticle;

	constructor(current: BlogArticle) {
		super('The website article changed since the last sync.');
		this.name = 'BlogConflictError';
		this.current = current;
	}
}

export function isConflict(error: unknown): error is BlogConflictError {
	return error instanceof BlogConflictError;
}
