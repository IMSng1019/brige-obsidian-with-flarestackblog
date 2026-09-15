import assert from 'node:assert/strict';
import test from 'node:test';
import { BlogConflictError, documentOf, isConflict, planSyncAction } from '../src/sync/state.ts';
import type { BlogArticle } from '../src/types.ts';

const article: BlogArticle = {
	id: 7,
	title: 'Remote title',
	slug: 'remote-title',
	content: { type: 'doc', content: [] },
	published: true,
	updatedAt: '2026-09-08T00:00:00.000Z',
	url: 'https://blog.example.com/post/remote-title',
};

test('uploads when only the local note changed', () => {
	assert.equal(planSyncAction({ force: false, localChanged: true, remoteChanged: false }), 'upload');
});

test('downloads when only the website copy changed', () => {
	assert.equal(planSyncAction({ force: false, localChanged: false, remoteChanged: true }), 'download');
});

test('asks the user when both sides changed since the last sync', () => {
	assert.equal(planSyncAction({ force: false, localChanged: true, remoteChanged: true }), 'conflict');
});

test('does nothing when neither side changed', () => {
	assert.equal(planSyncAction({ force: false, localChanged: false, remoteChanged: false }), 'noop');
});

test('force always uploads, even over a newer website revision', () => {
	assert.equal(planSyncAction({ force: true, localChanged: true, remoteChanged: true }), 'upload');
	assert.equal(planSyncAction({ force: true, localChanged: false, remoteChanged: true }), 'upload');
});

test('treats a post without a body as an empty document', () => {
	assert.deepEqual(documentOf(null), { type: 'doc', content: [] });
	assert.deepEqual(documentOf(undefined), { type: 'doc', content: [] });
	const document = { type: 'doc' as const, content: [{ type: 'paragraph' }] };
	assert.equal(documentOf(document), document);
});

test('only a conflict error is reported as a conflict', () => {
	const conflict = new BlogConflictError(article);
	assert.equal(isConflict(conflict), true);
	assert.equal(conflict.current.published, true);
	assert.equal(isConflict(new Error('nope')), false);
	assert.equal(isConflict(undefined), false);
});
