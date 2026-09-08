import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticate } from '../src/auth.ts';
import { validateArticlePayload, validateUpdatePayload } from '../src/validation.ts';

const env = { OBSIDIAN_SYNC_TOKEN: 'secret', DB: {} as never, PUBLIC_SITE_URL: 'https://blog.imsng.top' };

test('rejects missing and incorrect bearer tokens', () => {
	assert.equal(authenticate(new Request('https://example.com'), env)?.status, 401);
	assert.equal(authenticate(new Request('https://example.com', { headers: { Authorization: 'Bearer wrong' } }), env)?.status, 401);
	assert.equal(authenticate(new Request('https://example.com', { headers: { Authorization: 'Bearer secret' } }), env), undefined);
});

test('validates article and update payloads', () => {
	const article = validateArticlePayload({ title: 'Hello', content: { type: 'doc', content: [] } });
	assert.equal(article instanceof Response, false);
	const invalidArticle = validateArticlePayload({ title: '', content: { type: 'doc' } });
	assert.equal(invalidArticle instanceof Response, true);
	const update = validateUpdatePayload({ title: 'Hello', content: { type: 'doc' }, revision: 2, contentHash: 'a'.repeat(64) });
	assert.equal(update instanceof Response, false);
	const invalidUpdate = validateUpdatePayload({ title: 'Hello', content: { type: 'doc' }, revision: -1, contentHash: 'bad' });
	assert.equal(invalidUpdate instanceof Response, true);
});
