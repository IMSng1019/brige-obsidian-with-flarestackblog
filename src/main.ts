import { Plugin, TFile } from 'obsidian';
import { BlogApiClient } from './api/client';
import { registerCommands, runCreate, runUpload } from './commands';
import { DEFAULT_SETTINGS, BlogSyncSettingTab, type BlogSyncSettings } from './settings';
import { readSyncMetadata } from './sync/frontmatter';
import { SyncService } from './sync/sync-service';

export default class BlogSyncPlugin extends Plugin {
	settings!: BlogSyncSettings;
	syncService!: SyncService;
	private readonly pending = new Map<string, number>();
	private readonly updating = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.rebuildService();
		registerCommands(this);
		this.addSettingTab(new BlogSyncSettingTab(this.app, this));
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || file.extension !== 'md') return;
			menu.addItem((item) => item.setTitle('Create as website article').setIcon('upload-cloud').onClick(() => void runCreate(this, file)));
			menu.addItem((item) => item.setTitle('Upload linked article').setIcon('upload').onClick(() => void runUpload(this, file)));
		}));
		this.registerEvent(this.app.vault.on('modify', (file) => { if (file instanceof TFile) this.onModify(file); }));
	}

	async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<BlogSyncSettings>); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); this.rebuildService(); }

	private rebuildService(): void {
		const apiUrl = this.settings.apiUrl || DEFAULT_SETTINGS.apiUrl;
		const token = this.settings.apiToken || 'not-configured';
		this.syncService = new SyncService({ app: this.app, client: new BlogApiClient({ baseUrl: apiUrl, token }), publicSiteUrl: this.settings.publicSiteUrl, rootFolder: this.settings.syncFolder });
	}

	private onModify(file: TFile): void {
		if (!this.settings.autoSync || file.extension !== 'md') return;
		this.scheduleUpload(file, 750);
	}

	private scheduleUpload(file: TFile, delay: number): void {
		const existing = this.pending.get(file.path);
		if (existing !== undefined) window.clearTimeout(existing);
		const timer = window.setTimeout(() => { this.pending.delete(file.path); void this.autoUpload(file); }, delay);
		this.pending.set(file.path, timer);
	}

	private async autoUpload(file: TFile): Promise<void> {
		if (this.updating.has(file.path)) {
			this.scheduleUpload(file, 500);
			return;
		}
		try {
			const source = await this.app.vault.read(file);
			if (!readSyncMetadata(source).articleId) return;
			this.updating.add(file.path);
			await runUpload(this, file);
		} finally { this.updating.delete(file.path); }
	}
}
