import assert from 'node:assert/strict';
import test from 'node:test';
import { contentHash } from '../src/repository.ts';

test('Worker content hash is deterministic', async () => {
	const first = await contentHash('Title', { type: 'doc', content: [{ type: 'paragraph', attrs: { z: 1, a: 2 } }] });
	const second = await contentHash(' Title ', { content: [{ attrs: { a: 2, z: 1 }, type: 'paragraph' }], type: 'doc' });
	assert.equal(first, second);
	assert.match(first, /^[a-f0-9]{64}$/);
});
