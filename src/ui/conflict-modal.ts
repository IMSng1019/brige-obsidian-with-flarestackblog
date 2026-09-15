import { ButtonComponent, Modal, Notice, TFile } from 'obsidian';
import type { SyncService } from '../sync/sync-service';
import type { BlogConflictError } from '../sync/state';

export class ConflictModal extends Modal {
	constructor(app: Modal['app'], private readonly file: TFile, private readonly service: SyncService, private readonly conflict: BlogConflictError) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Blog article conflict' });
		contentEl.createEl('p', { text: `“${this.file.basename}” changed in this vault and on the website since the last sync.` });
		const buttons = contentEl.createDiv({ cls: 'blog-sync-conflict-buttons' });
		new ButtonComponent(buttons).setButtonText('Download website version').setCta().onClick(async () => {
			try {
				await this.service.downloadToFile(this.conflict.current, this.file);
				new Notice('Downloaded website version');
				this.close();
			} catch (error) {
				new Notice(error instanceof Error ? error.message : 'Download failed');
			}
		});
		new ButtonComponent(buttons).setButtonText('Force upload local version').onClick(async () => {
			try {
				await this.service.uploadFile(this.file, { force: true, published: this.conflict.current.published });
				new Notice('Uploaded local version');
				this.close();
			} catch (error) {
				new Notice(error instanceof Error ? error.message : 'Upload failed');
			}
		});
		new ButtonComponent(buttons).setButtonText('Cancel').onClick(() => this.close());
	}

	onClose(): void { this.contentEl.empty(); }
}
