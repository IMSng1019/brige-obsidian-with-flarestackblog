import type { TiptapDocument } from '../types';

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]));
	}
	return value;
}

export function stableStringify(value: unknown): string {
	return JSON.stringify(stableValue(value));
}

export async function calculateSyncHash(title: string, content: TiptapDocument): Promise<string> {
	const payload = stableStringify({ title: title.trim(), content });
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
