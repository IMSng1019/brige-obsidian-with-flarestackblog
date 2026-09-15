import assert from 'node:assert/strict';
import test from 'node:test';
import type { App, TFile } from 'obsidian';
import type { BlogApiClient } from '../src/api/client.ts';
import { markdownToTiptap, tiptapToMarkdown } from '../src/converter/index.ts';
import { readSyncMetadata } from '../src/sync/frontmatter.ts';
import { BlogConflictError } from '../src/sync/state.ts';
import { SyncService } from '../src/sync/sync-service.ts';
import type {
	AdminPost,
	CreatePostInput,
	TiptapDocument,
	UpdatePostInput,
} from '../src/types.ts';

class FakeFile {
	constructor(readonly path: string) {}

	get basename(): string {
		return (this.path.split('/').pop() ?? '').replace(/\.md$/u, '');
	}

	get extension(): string {
		return this.path.endsWith('.md') ? 'md' : '';
	}
}

class FakeVault {
	private readonly files = new Map<string, string>();
	private readonly folders = new Set<string>();

	seed(path: string, content: string): void {
		this.files.set(path, content);
	}

	content(path: string): string {
		const value = this.files.get(path);
		if (value === undefined) throw new Error(`no such note: ${path}`);
		return value;
	}

	paths(): string[] {
		return [...this.files.keys()];
	}

	async read(file: FakeFile): Promise<string> {
		return this.content(file.path);
	}

	async process(file: FakeFile, update: (content: string) => string): Promise<string> {
		const next = update(this.content(file.path));
		this.files.set(file.path, next);
		return next;
	}

	async modify(file: FakeFile, content: string): Promise<void> {
		this.files.set(file.path, content);
	}

	async create(path: string, content: string): Promise<FakeFile> {
		this.files.set(path, content);
		return new FakeFile(path);
	}

	async createFolder(path: string): Promise<void> {
		this.folders.add(path);
	}

	getMarkdownFiles(): FakeFile[] {
		return this.paths().map((path) => new FakeFile(path));
	}

	getAbstractFileByPath(path: string): FakeFile | null {
		return this.files.has(path) || this.folders.has(path) ? new FakeFile(path) : null;
	}

	getName(): string {
		return 'TestVault';
	}
}

/** Minimal stand-in for the Admin API that mirrors its observable behavior. */
class FakeBlogApi {
	private readonly posts = new Map<number, AdminPost>();
	private nextId = 1;
	readonly created: CreatePostInput[] = [];
	readonly updates: Array<{ id: number; input: UpdatePostInput }> = [];
	readonly published: number[] = [];
	readonly unpublished: number[] = [];
	readonly listCalls: Array<{ offset: number; limit: number }> = [];

	seed(input: { title: string; contentJson?: TiptapDocument | null; status?: AdminPost['status'] }): AdminPost {
		const id = this.nextId;
		this.nextId += 1;
		const post: AdminPost = {
			id,
			title: input.title,
			summary: null,
			slug: input.title.toLowerCase().replace(/\s+/gu, '-'),
			status: input.status ?? 'draft',
			contentJson: input.contentJson ?? null,
			publishedAt: null,
			pinnedAt: null,
			createdAt: '2026-09-08T00:00:00.000Z',
			updatedAt: '2026-09-08T00:00:00.000Z',
		};
		this.posts.set(id, post);
		return post;
	}

	async createPost(input: CreatePostInput): Promise<{ id: number }> {
		this.created.push(input);
		const post = this.seed({ title: input.title, contentJson: input.contentJson ?? null });
		return { id: post.id };
	}

	/** Simulates an edit made on the website (browser, another device, a script). */
	remoteEdit(id: number, contentJson: TiptapDocument): void {
		const post = this.posts.get(id);
		if (!post) throw new Error(`post ${id} not found`);
		post.contentJson = contentJson;
		post.updatedAt = '2026-09-10T00:00:00.000Z';
	}

	async getPost(id: number): Promise<AdminPost> {
		const post = this.posts.get(id);
		if (!post) throw new Error(`post ${id} not found`);
		return { ...post };
	}

	async updatePost(id: number, input: UpdatePostInput): Promise<AdminPost> {
		const post = this.posts.get(id);
		if (!post) throw new Error(`post ${id} not found`);
		this.updates.push({ id, input });
		const next: AdminPost = {
			...post,
			title: input.title ?? post.title,
			contentJson: input.contentJson === undefined ? post.contentJson : input.contentJson,
			updatedAt: '2026-09-09T00:00:00.000Z',
		};
		this.posts.set(id, next);
		return { ...next };
	}

	async publishPost(id: number): Promise<void> {
		const post = this.posts.get(id);
		if (!post) throw new Error(`post ${id} not found`);
		this.published.push(id);
		post.status = 'published';
	}

	async unpublishPost(id: number): Promise<void> {
		const post = this.posts.get(id);
		if (!post) throw new Error(`post ${id} not found`);
		this.unpublished.push(id);
		post.status = 'draft';
	}

	async deletePost(id: number): Promise<void> {
		this.posts.delete(id);
	}

	async listPosts(options: { offset?: number; limit?: number } = {}) {
		const offset = options.offset ?? 0;
		const limit = options.limit ?? 50;
		this.listCalls.push({ offset, limit });
		const items = [...this.posts.values()].sort((a, b) => a.id - b.id).slice(offset, offset + limit);
		return {
			items,
			total: this.posts.size,
			statusCounts: {
				draft: [...this.posts.values()].filter((post) => post.status === 'draft').length,
				published: [...this.posts.values()].filter((post) => post.status === 'published').length,
			},
		};
	}
}

function createHarness() {
	const vault = new FakeVault();
	const api = new FakeBlogApi();
	const service = new SyncService({
		app: { vault } as unknown as App,
		client: api as unknown as BlogApiClient,
		publicSiteUrl: 'https://blog.example.com',
		rootFolder: 'Blog',
	});
	return { vault, api, service, file: (path: string) => new FakeFile(path) as unknown as TFile };
}

const NOTE = '# Hello\n\nBody text';

test('creates an article carrying the note body and links the note', async () => {
	const { vault, api, service, file } = createHarness();
	vault.seed('Notes/Hello.md', NOTE);

	const result = await service.createFromFile(file('Notes/Hello.md'));

	assert.equal(result.created, true);
	assert.equal(api.created.length, 1);
	assert.equal(api.created[0]?.title, 'Hello');
	assert.deepEqual(api.created[0]?.contentJson, markdownToTiptap(NOTE));

	const metadata = readSyncMetadata(vault.content('Notes/Hello.md'));
	assert.equal(metadata.articleId, result.article.id);
	assert.equal(metadata.slug, 'hello');
	assert.equal(metadata.url, 'https://blog.example.com/post/hello');
	assert.equal(metadata.obsidianUri, 'obsidian://open?vault=TestVault&file=Notes%2FHello.md');
	assert.ok(metadata.contentHash);
	assert.ok(metadata.localHash);
});

test('creates and publishes in one action when asked', async () => {
	const { vault, api, service, file } = createHarness();
	vault.seed('Notes/Hello.md', NOTE);

	const result = await service.createFromFile(file('Notes/Hello.md'), true);

	assert.deepEqual(api.published, [result.article.id]);
	assert.equal(result.article.published, true);
});

test('uploads only when the note changed', async () => {
	const { vault, api, service, file } = createHarness();
	vault.seed('Notes/Hello.md', NOTE);
	const note = file('Notes/Hello.md');
	await service.createFromFile(note);

	await service.uploadFile(note);
	assert.equal(api.updates.length, 0, 'an untouched note must not be written back');

	vault.seed('Notes/Hello.md', vault.content('Notes/Hello.md').replace('Body text', 'Edited text'));
	await service.uploadFile(note);

	assert.equal(api.updates.length, 1);
	assert.deepEqual(api.updates[0]?.input.contentJson, markdownToTiptap('# Hello\n\nEdited text'));

	await service.uploadFile(note);
	assert.equal(api.updates.length, 1, 'the refreshed hashes must make the next upload a no-op');
});

test('downloads the website version when only the website changed', async () => {
	const { vault, api, service, file } = createHarness();
	vault.seed('Notes/Hello.md', NOTE);
	const note = file('Notes/Hello.md');
	const created = await service.createFromFile(note);

	api.remoteEdit(created.article.id, markdownToTiptap('# Hello\n\nWebsite text'));
	const result = await service.uploadFile(note);

	assert.equal(api.updates.length, 0, 'a newer website revision must not be overwritten');
	assert.equal(result.created, false);
	assert.match(vault.content('Notes/Hello.md'), /Website text/);
	assert.doesNotMatch(vault.content('Notes/Hello.md'), /Body text/);
});

test('reports a conflict when both sides changed', async () => {
	const { vault, api, service, file } = createHarness();
	vault.seed('Notes/Hello.md', NOTE);
	const note = file('Notes/Hello.md');
	const created = await service.createFromFile(note);

	api.remoteEdit(created.article.id, markdownToTiptap('# Hello\n\nWebsite text'));
	vault.seed('Notes/Hello.md', vault.content('Notes/Hello.md').replace('Body text', 'Local text'));

	await assert.rejects(
		() => service.uploadFile(note),
		(error: unknown) => {
			assert.ok(error instanceof BlogConflictError);
			assert.equal(error.current.id, created.article.id);
			assert.match(viTiptapToText(error.current.content), /Website text/);
			return true;
		},
	);
	assert.match(vault.content('Notes/Hello.md'), /Local text/, 'the local note must stay untouched');
});

test('force uploads the local version even when the website changed', async () => {
	const { vault, api, service, file } = createHarness();
	vault.seed('Notes/Hello.md', NOTE);
	const note = file('Notes/Hello.md');
	const created = await service.createFromFile(note, true);
	api.remoteEdit(created.article.id, markdownToTiptap('# Hello\n\nWebsite text'));
	vault.seed('Notes/Hello.md', vault.content('Notes/Hello.md').replace('Body text', 'Local text'));

	await service.uploadFile(note, { force: true, published: true });

	assert.equal(api.updates.length, 1);
	assert.deepEqual(api.updates[0]?.input.contentJson, markdownToTiptap('# Hello\n\nLocal text'));
	assert.deepEqual(api.published, [created.article.id, created.article.id]);
});

test('unpublishes an article that is no longer meant to be public', async () => {
	const { vault, api, service, file } = createHarness();
	vault.seed('Notes/Hello.md', NOTE);
	const note = file('Notes/Hello.md');
	const created = await service.createFromFile(note, true);

	vault.seed('Notes/Hello.md', vault.content('Notes/Hello.md').replace('Body text', 'Draft text'));
	await service.uploadFile(note, { published: false });

	assert.deepEqual(api.unpublished, [created.article.id]);
});

test('syncs a whole folder from the list endpoint', async () => {
	const { vault, api, service, file } = createHarness();
	vault.seed('Notes/Hello.md', NOTE);
	await service.createFromFile(file('Notes/Hello.md'));
	const other = api.seed({ title: 'Remote only', contentJson: markdownToTiptap('# Remote only\n\nFrom the website') });

	const first = await service.syncFolder();
	assert.deepEqual(first, { imported: 1, updated: 0, skipped: 1 });
	assert.match(vault.content('Blog/remote-only.md'), /From the website/);
	assert.deepEqual(api.listCalls, [{ offset: 0, limit: 50 }]);

	api.remoteEdit(other.id, markdownToTiptap('# Remote only\n\nChanged on the website'));
	const second = await service.syncFolder();
	assert.deepEqual(second, { imported: 0, updated: 1, skipped: 1 });
	assert.match(vault.content('Blog/remote-only.md'), /Changed on the website/);
});

test('downloads a linked note through the article id', async () => {
	const { vault, api, service, file } = createHarness();
	vault.seed('Notes/Hello.md', NOTE);
	const note = file('Notes/Hello.md');
	const created = await service.createFromFile(note);
	api.remoteEdit(created.article.id, markdownToTiptap('# Hello\n\nPulled text'));

	await service.downloadLinkedFile(note);

	assert.match(vault.content('Notes/Hello.md'), /Pulled text/);
});

function viTiptapToText(document: TiptapDocument): string {
	return tiptapToMarkdown(document);
}
