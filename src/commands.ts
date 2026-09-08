import { Notice, TFile } from 'obsidian';
import type BlogSyncPlugin from './main';
import { ConflictModal } from './ui/conflict-modal';
import { isConflict } from './sync/sync-service';
import { readSyncMetadata } from './sync/frontmatter';

function activeMarkdownFile(plugin: BlogSyncPlugin): TFile | undefined {
	const file = plugin.app.workspace.getActiveFile();
	return file instanceof TFile ? file : undefined;
}

export function registerCommands(plugin: BlogSyncPlugin): void {
	plugin.addCommand({ id: 'create-website-article', name: 'Create as website article', checkCallback: (checking) => { const file = activeMarkdownFile(plugin); if (!file) return false; if (!checking) void runCreate(plugin, file); return true; } });
	plugin.addCommand({ id: 'upload-linked-article', name: 'Upload linked article', checkCallback: (checking) => { const file = activeMarkdownFile(plugin); if (!file) return false; if (!checking) void runUpload(plugin, file); return true; } });
	plugin.addCommand({ id: 'download-linked-article', name: 'Download website article', checkCallback: (checking) => { const file = activeMarkdownFile(plugin); if (!file) return false; if (!checking) void runDownload(plugin, file); return true; } });
	plugin.addCommand({ id: 'sync-blog-folder', name: 'Sync blog articles to folder', callback: () => void runFolderSync(plugin) });
}

export async function runCreate(plugin: BlogSyncPlugin, file: TFile): Promise<void> {
	try {
		const source = await plugin.app.vault.read(file);
		if (readSyncMetadata(source).articleId) {
			new Notice('This note is already linked; use upload linked article');
			return;
		}
		await plugin.syncService.createFromFile(file, plugin.settings.publishOnSync); new Notice('Created website article and linked this note');
	} catch (error) { showError(plugin, file, error); }
}

export async function runUpload(plugin: BlogSyncPlugin, file: TFile, force = false): Promise<void> {
	try { await plugin.syncService.uploadFile(file, force, plugin.settings.publishOnSync); new Notice('Website article updated'); } catch (error) { showError(plugin, file, error); }
}

async function runDownload(plugin: BlogSyncPlugin, file: TFile): Promise<void> {
	try { await plugin.syncService.downloadLinkedFile(file); new Notice('Downloaded website article'); } catch (error) { showError(plugin, file, error); }
}

async function runFolderSync(plugin: BlogSyncPlugin): Promise<void> {
	try { const result = await plugin.syncService.syncFolder(); new Notice(`Blog sync finished: ${result.imported} imported, ${result.updated} updated`); } catch (error) { showError(plugin, undefined, error); }
}

function showError(plugin: BlogSyncPlugin, file: TFile | undefined, error: unknown): void {
	if (file && isConflict(error)) { new ConflictModal(plugin.app, file, plugin.syncService, error).open(); return; }
	new Notice(error instanceof Error ? error.message : 'Blog sync failed');
}
