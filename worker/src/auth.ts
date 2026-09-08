import type { Env } from './types';

function unauthorized(): Response {
	return Response.json({ error: { code: 'UNAUTHORIZED', message: 'A valid bearer token is required' } }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
}

function safeEqual(left: string, right: string): boolean {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);
	if (leftBytes.length !== rightBytes.length) return false;
	let difference = 0;
	for (let index = 0; index < leftBytes.length; index += 1) difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	return difference === 0;
}

export function authenticate(request: Request, env: Env): Response | undefined {
	const authorization = request.headers.get('Authorization') ?? '';
	const [scheme, token] = authorization.split(' ', 2);
	if (scheme !== 'Bearer' || !token || !env.OBSIDIAN_SYNC_TOKEN || !safeEqual(token, env.OBSIDIAN_SYNC_TOKEN)) return unauthorized();
	return undefined;
}
