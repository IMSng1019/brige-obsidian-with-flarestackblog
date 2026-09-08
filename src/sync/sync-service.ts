import type { App, TFile, Vault } from 'obsidian';
import { BlogApiClient, BlogApiError } from '../api/client';
import { markdownToTiptap, tiptapToMarkdown } from '../converter';
import type { BlogArticle, SyncMetadata } from '../types';
import { calculateSyncHash } from './hash';
import { readSyncMetadata, replaceNoteBody, splitFrontmatter, writeSyncMetadata } from './frontmatter';

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
		const article = await this.client.createArticle({ title, content, path: file.path, published });
		const localHash = await calculateSyncHash(title, content);
		const metadata = this.metadataForArticle(article, file.path, localHash, title);
		await this.vault.process(file, (current) => writeSyncMetadata(current, metadata));
		return { article, path: file.path, created: true };
	}

	async uploadFile(file: TFile, force = false, published = false): Promise<SyncResult> {
		const source = await this.vault.read(file);
		const metadata = readSyncMetadata(source);
		if (!metadata.articleId) return this.createFromFile(file, published);
		const { body } = splitFrontmatter(source);
		const content = markdownToTiptap(body);
		const title = readSyncMetadata(source).title ?? titleForFile(file);
		const contentHash = await calculateSyncHash(title, content);
		if (!force && metadata.localHash === contentHash) {
			const current = await this.client.getArticle(metadata.articleId);
			if (current.contentHash !== metadata.contentHash || current.revision !== metadata.revision) {
				await this.downloadToFile(current, file);
			}
			return { article: current, path: file.path, created: false };
		}
		const expected = metadata.contentHash ?? (await this.client.getArticle(metadata.articleId)).contentHash;
		const article = await this.client.updateArticle(metadata.articleId, {
			title,
			content,
			path: file.path,
			published,
			revision: metadata.revision ?? 0,
			contentHash: expected,
			force,
		});
		await this.vault.process(file, (current) => writeSyncMetadata(current, this.metadataForArticle(article, file.path, contentHash, title)));
		return { article, path: file.path, created: false };
	}

	async downloadToFile(article: BlogArticle, file?: TFile): Promise<TFile> {
		const path = file?.path ?? pathForFolder(this.rootFolder, article.slug);
		const markdown = tiptapToMarkdown(article.content);
		const localHash = await calculateSyncHash(article.title, markdownToTiptap(markdown));
		const metadata = this.metadataForArticle(article, path, localHash, article.title);
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

	async syncFolder(): Promise<{ imported: number; updated: number; skipped: number }> {
		let cursor: number | undefined;
		let imported = 0;
		let updated = 0;
		let skipped = 0;
		const remote: BlogArticle[] = [];
		do {
			const page = await this.client.listArticles(cursor);
			remote.push(...page.items);
			cursor = page.nextCursor ?? undefined;
		} while (cursor !== undefined);

		for (const article of remote) {
			const linked = await this.findLinkedFile(article);
			if (linked) {
				const source = await this.vault.read(linked);
				const metadata = readSyncMetadata(source);
				if (metadata.revision !== article.revision || metadata.contentHash !== article.contentHash) {
					await this.downloadToFile(article, linked);
					updated += 1;
				} else skipped += 1;
			} else {
				await this.downloadToFile(article);
				imported += 1;
			}
		}
		return { imported, updated, skipped };
	}

	async downloadLinkedFile(file: TFile): Promise<TFile> {
		const metadata = readSyncMetadata(await this.vault.read(file));
		if (!metadata.articleId) throw new Error('This note is not linked to a blog article');
		return this.downloadToFile(await this.client.getArticle(metadata.articleId), file);
	}

	private metadataForArticle(article: BlogArticle, path: string, localHash: string, title: string): SyncMetadata {
		return {
			title,
			articleId: article.id,
			slug: article.slug,
			url: article.url || `${this.publicSiteUrl}/post/${article.slug}`,
			revision: article.revision,
			contentHash: article.contentHash,
			updatedAt: article.updatedAt,
			obsidianUri: `obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}&file=${encodeURIComponent(path)}`,
			localHash,
		};
	}

	private async findLinkedFile(article: BlogArticle): Promise<TFile | undefined> {
		const markdownFiles = this.app.vault.getMarkdownFiles();
		for (const file of markdownFiles) {
			const metadata = readSyncMetadata(await this.vault.read(file));
			if (metadata.articleId === article.id || metadata.slug === article.slug) return file;
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

export function isConflict(error: unknown): error is BlogApiError {
	return error instanceof BlogApiError && error.status === 409;
}
