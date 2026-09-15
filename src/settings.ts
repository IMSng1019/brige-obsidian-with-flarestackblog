import { App, PluginSettingTab, Setting } from 'obsidian';
import type BlogSyncPlugin from './main';

export interface BlogSyncSettings {
	apiUrl: string;
	apiKey: string;
	publicSiteUrl: string;
	syncFolder: string;
	autoSync: boolean;
	publishOnSync: boolean;
}

export const DEFAULT_SETTINGS: BlogSyncSettings = {
	apiUrl: 'https://blog.imsng.top',
	apiKey: '',
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
		new Setting(containerEl).setName('Blog URL').setDesc('Origin of the blog you deploy to. Article requests go to this site.').addText((text) => text.setPlaceholder(DEFAULT_SETTINGS.apiUrl).setValue(this.plugin.settings.apiUrl).onChange(async (value) => { this.plugin.settings.apiUrl = value.trim(); await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('Admin API key').setDesc('Create one on your site first, then paste it here. It is stored on this device and sent only to your blog.').addText((text) => { text.inputEl.type = 'password'; text.setValue(this.plugin.settings.apiKey).onChange(async (value) => { this.plugin.settings.apiKey = value.trim(); await this.plugin.saveSettings(); }); });
		new Setting(containerEl).setName('Public site URL').setDesc('Used to build article links').addText((text) => text.setValue(this.plugin.settings.publicSiteUrl).onChange(async (value) => { this.plugin.settings.publicSiteUrl = value.trim(); await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('Sync folder').setDesc('Folder for articles imported from the website').addText((text) => text.setPlaceholder('Blog').setValue(this.plugin.settings.syncFolder).onChange(async (value) => { this.plugin.settings.syncFolder = value.trim(); await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('Sync modified linked notes automatically').addToggle((toggle) => toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => { this.plugin.settings.autoSync = value; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('Publish when syncing').setDesc('When disabled, creates and updates remain drafts').addToggle((toggle) => toggle.setValue(this.plugin.settings.publishOnSync).onChange(async (value) => { this.plugin.settings.publishOnSync = value; await this.plugin.saveSettings(); }));
	}
}
