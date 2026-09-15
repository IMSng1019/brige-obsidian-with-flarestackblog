/**
 * The Admin list endpoint clamps `limit` with `Math.min(limit, 50)`, so the
 * client never asks for more than it would receive.
 */
export const POSTS_PAGE_SIZE = 50;

/**
 * Builds the query of `GET /api/admin/posts` for a full sync: every item
 * carries its TipTap body, and the order is the immutable `id`, so offset
 * pagination stays stable even while the sync itself writes to the same table.
 */
export function buildListPostsQuery(
	options: { offset?: number; limit?: number } = {},
): string {
	const limit = Math.min(
		POSTS_PAGE_SIZE,
		Math.max(1, options.limit ?? POSTS_PAGE_SIZE),
	);
	const offset = Math.max(0, options.offset ?? 0);
	return new URLSearchParams({
		includeContent: 'true',
		sortBy: 'id',
		sortDir: 'ASC',
		limit: String(limit),
		offset: String(offset),
	}).toString();
}
