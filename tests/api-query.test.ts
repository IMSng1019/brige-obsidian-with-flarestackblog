import assert from 'node:assert/strict';
import test from 'node:test';
import { buildListPostsQuery, POSTS_PAGE_SIZE } from '../src/api/query.ts';

test('asks for bodies ordered by the immutable id', () => {
	const query = new URLSearchParams(buildListPostsQuery({ offset: 100, limit: 50 }));
	assert.equal(query.get('includeContent'), 'true');
	assert.equal(query.get('sortBy'), 'id');
	assert.equal(query.get('sortDir'), 'ASC');
	assert.equal(query.get('limit'), '50');
	assert.equal(query.get('offset'), '100');
});

test('never asks for more items than the Admin list returns', () => {
	const query = new URLSearchParams(buildListPostsQuery({ limit: 500 }));
	assert.equal(query.get('limit'), String(POSTS_PAGE_SIZE));
});

test('normalizes missing or negative paging values', () => {
	const defaults = new URLSearchParams(buildListPostsQuery());
	assert.equal(defaults.get('limit'), String(POSTS_PAGE_SIZE));
	assert.equal(defaults.get('offset'), '0');

	const clamped = new URLSearchParams(buildListPostsQuery({ limit: 0, offset: -5 }));
	assert.equal(clamped.get('limit'), '1');
	assert.equal(clamped.get('offset'), '0');
});
