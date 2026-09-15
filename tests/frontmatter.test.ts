import assert from 'node:assert/strict';
import test from 'node:test';
import {
	readSyncMetadata,
	replaceNoteBody,
	writeSyncMetadata,
} from '../src/sync/frontmatter.ts';

test('reads and writes sync metadata without changing the body', () => {
	const source = '---\ntags: [one, two]\ntitle: Existing\n---\n\n# Body\n';
	const updated = writeSyncMetadata(source, {
		title: 'Hello',
		articleId: 42,
		slug: 'hello-world',
		url: 'https://blog.imsng.top/post/hello-world',
		contentHash: 'remote-hash',
		localHash: 'local-hash',
		updatedAt: '2026-09-08T00:00:00.000Z',
	});

	assert.deepEqual(readSyncMetadata(updated), {
		title: 'Hello',
		articleId: 42,
		slug: 'hello-world',
		url: 'https://blog.imsng.top/post/hello-world',
		contentHash: 'remote-hash',
		localHash: 'local-hash',
		updatedAt: '2026-09-08T00:00:00.000Z',
	});
	assert.match(updated, /tags: \[one, two\]/);
	assert.match(updated, /# Body/);
});

test('drops the revision key written by earlier plugin versions', () => {
	const source = '---\nblog_id: 7\nblog_revision: 3\nblog_content_hash: old\n---\nBody';
	const updated = writeSyncMetadata(source, { contentHash: 'new' });
	assert.match(updated, /blog_content_hash: new/);
	assert.doesNotMatch(updated, /blog_revision/);
});

test('adds frontmatter when a note has none and preserves unrelated keys', () => {
	const updated = writeSyncMetadata('# Body', { articleId: 1 });
	assert.match(updated, /^---\nblog_id: 1\n---\n\n# Body$/);
	assert.deepEqual(readSyncMetadata(updated), { articleId: 1 });
});

test('replaces a note body while preserving unrelated frontmatter', () => {
	const source = '---\ntags: [one]\ncustom: keep\n---\n\nOld body';
	const updated = writeSyncMetadata(source, { title: 'Remote title' });
	const replaced = replaceNoteBody(updated, 'New body');
	assert.match(replaced, /tags: \[one\]/);
	assert.match(replaced, /custom: keep/);
	assert.match(replaced, /New body/);
});

test('removes plugin-owned values when metadata fields are undefined', () => {
	const source = '---\nblog_id: 10\nblog_slug: old\ncustom: keep\n---\nBody';
	const updated = writeSyncMetadata(source, { articleId: undefined, slug: undefined });
	assert.equal(updated, '---\ncustom: keep\n---\nBody');
});
