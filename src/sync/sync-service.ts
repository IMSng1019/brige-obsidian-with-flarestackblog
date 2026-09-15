import type { App, TFile, Vault } from 'obsidian';
import type { BlogApiClient } from '../api/client';
import { POSTS_PAGE_SIZE } from '../api/query';
import { markdownToTiptap, tiptapToMarkdown } from '../converter';
import type { AdminPost, BlogArticle, SyncMetadata, TiptapDocument } from '../types';
import { calculateSyncHash } from './hash';
import { readSyncMetadata, replaceNoteBody, splitFrontmatter, writeSyncMetadata } from './frontmatter';
import { BlogConflictError, documentOf, planSyncAction } from './state';

export interface SyncServiceOptions {
	app: App;
	client: BlogApiClient;
	publicSiteUrl: string;
	rootFolder: string;
}

export interface SyncResult {
	article: BlogArticle;
	path: string;
	created: boolean;
}

export interface UploadOptions {
	/** Overwrite the website copy even when it changed since the last sync. */
	force?: boolean;
	/** Publish after uploading; when false, an already published article is unpublished. */
	published?: boolean;
}

export interface FolderSyncResult {
	imported: number;
	updated: number;
	skipped: number;
}

const MAX_LIST_PAGES = 200;

function safeFileName(value: string): string {
	const normalized = value.trim().replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ');
	return (normalized || 'untitled').slice(0, 120);
}

function titleForFile(file: TFile): string {
	return file.basename || 'Untitled';
}

function pathForFolder(rootFolder: string, slug: string): string {
	const folder = rootFolder.trim().replace(/^\/+|\/+$/g, '');
	return folder ? `${folder}/${safeFileName(slug)}.md` : `${safeFileName(slug)}.md`;
}

export class SyncService {
	private readonly vault: Vault;
	private readonly app: App;
	private readonly client: BlogApiClient;
	private readonly publicSiteUrl: string;
	private readonly rootFolder: string;

	constructor(options: SyncServiceOptions) {
		this.app = options.app;
		this.vault = options.app.vault;
		this.client = options.client;
		this.publicSiteUrl = options.publicSiteUrl.replace(/\/+$/, '');
		this.rootFolder = options.rootFolder;
	}

	async createFromFile(file: TFile, published = false): Promise<SyncResult> {
		const source = await this.vault.read(file);
		const { body } = splitFrontmatter(source);
		const title = titleForFile(file);
		const content = markdownToTiptap(body);
		// The Admin API only reuses an empty draft when the request has no data,
		// so sending the note content always creates a brand new article.
		const created = await this.client.createPost({ title, contentJson: content });
		if (published) await this.client.publishPost(created.id);
		const post = await this.client.getPost(created.id);
		const article = this.articleOf(post);
		await this.writeMetadata(file, article, title, content);
		return { article, path: file.path, created: true };
	}

	async uploadFile(file: TFile, options: UploadOptions = {}): Promise<SyncResult> {
		const { force = false, published = false } = options;
		const source = await this.vault.read(file);
		const metadata = readSyncMetadata(source);
		if (!metadata.articleId) return this.createFromFile(file, published);

		const { body } = splitFrontmatter(source);
		const title = metadata.title ?? titleForFile(file);
		const content = markdownToTiptap(body);
		const localHash = await calculateSyncHash(title, content);
		const localChanged = metadata.localHash !== localHash;

		// The Admin API has no conditional update, so the plugin re-reads the
		// article and compares hashes before writing. `force` skips the probe.
		const remote = force ? undefined : await this.client.getPost(metadata.articleId);
		const remoteChanged = remote === undefined ? false : metadata.contentHash !== (await calculateSyncHash(remote.title, documentOf(remote.contentJson)));

		const action = planSyncAction({ force, localChanged, remoteChanged });
		if (remote) {
			if (action === 'noop') return { article: this.articleOf(remote), path: file.path, created: false };
			if (action === 'conflict') throw new BlogConflictError(this.articleOf(remote));
			if (action === 'download') {
				await this.downloadToFile(this.articleOf(remote), file);
				return { article: this.articleOf(remote), path: file.path, created: false };
			}
		}

		const updated = await this.client.updatePost(metadata.articleId, { title, contentJson: content });
		await this.setPublished(updated, published);
		const article = this.articleOf(updated, published);
		await this.writeMetadata(file, article, title, content);
		return { article, path: file.path, created: false };
	}

	async downloadToFile(article: BlogArticle, file?: TFile): Promise<TFile> {
		const path = file?.path ?? pathForFolder(this.rootFolder, article.slug);
		const markdown = tiptapToMarkdown(article.content);
		const metadata = this.metadataForArticle(article, path, {
			title: article.title,
			localHash: await calculateSyncHash(article.title, markdownToTiptap(markdown)),
			remoteHash: await calculateSyncHash(article.title, article.content),
		});
		const existing = file ? await this.vault.read(file) : undefined;
		const content = existing ? writeSyncMetadata(replaceNoteBody(existing, markdown), metadata) : writeSyncMetadata(markdown, metadata);
		if (file) {
			await this.vault.modify(file, content);
			return file;
		}
		const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		if (parent) await this.ensureFolder(parent);
		return this.vault.create(path, content);
	}

	async syncFolder(): Promise<FolderSyncResult> {
		const posts = await this.listAllPosts();
		let imported = 0;
		let updated = 0;
		let skipped = 0;
		for (const post of posts) {
			const article = this.articleOf(post);
			const linked = await this.findLinkedFile(post);
			if (!linked) {
				await this.downloadToFile(article);
				imported += 1;
				continue;
			}
			const metadata = readSyncMetadata(await this.vault.read(linked));
			const remoteHash = await calculateSyncHash(post.title, article.content);
			if (metadata.contentHash === remoteHash) {
				skipped += 1;
				continue;
			}
			await this.downloadToFile(article, linked);
			updated += 1;
		}
		return { imported, updated, skipped };
	}

	async downloadLinkedFile(file: TFile): Promise<TFile> {
		const metadata = readSyncMetadata(await this.vault.read(file));
		if (!metadata.articleId) throw new Error('This note is not linked to a blog article');
		return this.downloadToFile(this.articleOf(await this.client.getPost(metadata.articleId)), file);
	}

	private async listAllPosts(): Promise<AdminPost[]> {
		const posts: AdminPost[] = [];
		for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
			const result = await this.client.listPosts({ offset: posts.length, limit: POSTS_PAGE_SIZE });
			posts.push(...result.items);
			if (result.items.length === 0 || posts.length >= result.total) break;
		}
		return posts;
	}

	private async setPublished(post: AdminPost, published: boolean): Promise<void> {
		if (published) {
			// Publishing is also what refreshes the public snapshot the website
			// renders, so an already published article is published again.
			await this.client.publishPost(post.id);
			return;
		}
		if (post.status === 'published') await this.client.unpublishPost(post.id);
	}

	private articleOf(post: AdminPost, published?: boolean): BlogArticle {
		return {
			id: post.id,
			title: post.title,
			slug: post.slug,
			content: documentOf(post.contentJson),
			published: published ?? post.status === 'published',
			updatedAt: post.updatedAt,
			url: `${this.publicSiteUrl}/post/${post.slug}`,
		};
	}

	private async writeMetadata(file: TFile, article: BlogArticle, title: string, localContent: TiptapDocument): Promise<void> {
		const metadata = this.metadataForArticle(article, file.path, {
			title,
			localHash: await calculateSyncHash(title, localContent),
			remoteHash: await calculateSyncHash(article.title, article.content),
		});
		await this.vault.process(file, (current) => writeSyncMetadata(current, metadata));
	}

	private metadataForArticle(article: BlogArticle, path: string, hashes: { title: string; localHash: string; remoteHash: string }): SyncMetadata {
		return {
			title: hashes.title,
			articleId: article.id,
			slug: article.slug,
			url: article.url || `${this.publicSiteUrl}/post/${article.slug}`,
			contentHash: hashes.remoteHash,
			localHash: hashes.localHash,
			updatedAt: article.updatedAt,
			obsidianUri: `obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}&file=${encodeURIComponent(path)}`,
		};
	}

	private async findLinkedFile(post: AdminPost): Promise<TFile | undefined> {
		const markdownFiles = this.app.vault.getMarkdownFiles();
		for (const file of markdownFiles) {
			const metadata = readSyncMetadata(await this.vault.read(file));
			if (metadata.articleId === post.id || metadata.slug === post.slug) return file;
		}
		return undefined;
	}

	private async ensureFolder(path: string): Promise<void> {
		const segments = path.split('/').filter(Boolean);
		let current = '';
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(current)) await this.vault.createFolder(current);
		}
	}
}
