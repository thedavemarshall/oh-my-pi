/**
 * classifyKernelError — normalize a raw Jupyter `error` or `execute_reply`
 * content payload into a language-agnostic shape.
 *
 * Language-specific post-processing (e.g. Python's KeyboardInterrupt vs user
 * abort distinction) is the caller's responsibility — this function handles
 * only the wire-level extraction.
 */

export interface KernelError {
	name: string;
	value: string;
	traceback: string[];
}

/**
 * Extract a normalized KernelError from a Jupyter error payload (the `content`
 * field of an `error` IOPub message or an `execute_reply` with status "error").
 */
export function classifyKernelError(content: unknown): KernelError {
	const c = (content ?? {}) as { ename?: unknown; evalue?: unknown; traceback?: unknown };
	const traceback = Array.isArray(c.traceback) ? c.traceback.map(line => String(line)) : [];
	return {
		name: String(c.ename ?? "Error"),
		value: String(c.evalue ?? ""),
		traceback,
	};
}
