import { App, PluginSettingTab, Setting } from 'obsidian';
import type BlogSyncPlugin from './main';

export interface BlogSyncSettings {
	apiUrl: string;
	apiToken: string;
	publicSiteUrl: string;
	syncFolder: string;
	autoSync: boolean;
	publishOnSync: boolean;
}

export const DEFAULT_SETTINGS: BlogSyncSettings = {
	apiUrl: 'https://blog.imsng.top',
	apiToken: '',
	publicSiteUrl: 'https://blog.imsng.top',
	syncFolder: 'Blog',
	autoSync: true,
	publishOnSync: false,
};

export class BlogSyncSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: BlogSyncPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName('Connection').setHeading();
		new Setting(containerEl).setName('API URL').setDesc('Worker endpoint for article synchronization').addText((text) => text.setPlaceholder(DEFAULT_SETTINGS.apiUrl).setValue(this.plugin.settings.apiUrl).onChange(async (value) => { this.plugin.settings.apiUrl = value.trim(); await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('API token').setDesc('Bearer token for the worker').addText((text) => { text.inputEl.type = 'password'; text.setValue(this.plugin.settings.apiToken).onChange(async (value) => { this.plugin.settings.apiToken = value; await this.plugin.saveSettings(); }); });
		new Setting(containerEl).setName('Public site URL').setDesc('Used to build article links').addText((text) => text.setValue(this.plugin.settings.publicSiteUrl).onChange(async (value) => { this.plugin.settings.publicSiteUrl = value.trim(); await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('Sync folder').setDesc('Folder for articles imported from the website').addText((text) => text.setPlaceholder('Blog').setValue(this.plugin.settings.syncFolder).onChange(async (value) => { this.plugin.settings.syncFolder = value.trim(); await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('Sync modified linked notes automatically').addToggle((toggle) => toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => { this.plugin.settings.autoSync = value; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('Publish when syncing').setDesc('When disabled, creates and updates remain drafts').addToggle((toggle) => toggle.setValue(this.plugin.settings.publishOnSync).onChange(async (value) => { this.plugin.settings.publishOnSync = value; await this.plugin.saveSettings(); }));
	}
}
