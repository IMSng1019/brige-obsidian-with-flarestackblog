import { ButtonComponent, Modal, Notice, TFile } from 'obsidian';
import type { BlogApiError } from '../api/client';
import type { SyncService } from '../sync/sync-service';

export class ConflictModal extends Modal {
	constructor(app: Modal['app'], private readonly file: TFile, private readonly service: SyncService, private readonly error: BlogApiError) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Blog article conflict' });
		contentEl.createEl('p', { text: `“${this.file.basename}” changed on the website after the last sync.` });
		const buttons = contentEl.createDiv({ cls: 'blog-sync-conflict-buttons' });
		new ButtonComponent(buttons).setButtonText('Download website version').setCta().onClick(async () => { try { if (this.error.current) await this.service.downloadToFile(this.error.current, this.file); else await this.service.downloadLinkedFile(this.file); new Notice('Downloaded website version'); this.close(); } catch (error) { new Notice(error instanceof Error ? error.message : 'Download failed'); } });
		new ButtonComponent(buttons).setButtonText('Force upload local version').onClick(async () => { try { await this.service.uploadFile(this.file, true); new Notice('Uploaded local version'); this.close(); } catch (error) { new Notice(error instanceof Error ? error.message : 'Upload failed'); } });
		new ButtonComponent(buttons).setButtonText('Cancel').onClick(() => this.close());
	}

	onClose(): void { this.contentEl.empty(); }
}
