interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	all<T>(): Promise<{ results: T[] }>;
	first<T>(): Promise<T | null>;
	run(): Promise<{ meta: { changes: number } }>;
}

interface D1Database {
	prepare(query: string): D1PreparedStatement;
}
