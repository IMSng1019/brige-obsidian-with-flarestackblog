import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSyncHash } from '../src/sync/hash.ts';

test('content hash is stable when object key order changes', async () => {
	const first = await calculateSyncHash('Title', { type: 'doc', content: [{ type: 'paragraph', attrs: { z: 1, a: 2 }, content: [{ type: 'text', text: 'Body' }] }] });
	const second = await calculateSyncHash(' Title ', { content: [{ content: [{ text: 'Body', type: 'text' }], attrs: { a: 2, z: 1 }, type: 'paragraph' }], type: 'doc' });
	assert.equal(first, second);
});
