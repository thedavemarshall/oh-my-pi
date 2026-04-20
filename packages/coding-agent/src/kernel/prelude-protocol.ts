/**
 * Prelude protocol — the opt-in convention for cross-language kernel plugins.
 *
 * Plugins emit `application/x-omp-status` display_data messages to signal
 * progress, phase changes, or heartbeats. `renderKernelDisplay` recognizes
 * this MIME natively and surfaces status updates in the TUI.
 *
 * Plugins also expose a `PreludeDocs` dict at a plugin-chosen well-known name
 * in the kernel runtime and supply a language-specific introspection snippet
 * that prints the dict as JSON. `introspectPreludeDocs` runs the snippet once
 * at kernel startup to build the model-facing tool description.
 */

import type { JupyterKernel } from "./jupyter-kernel";
import type { KernelStatusEvent, PreludeDocs } from "./types";

export const OMP_STATUS_MIME = "application/x-omp-status";

/**
 * Parse an x-omp-status display_data payload into a KernelStatusEvent.
 * Accepts either a JSON string or an object. Requires a `kind` field.
 */
export function parseStatusEvent(data: unknown): KernelStatusEvent {
	let obj: Record<string, unknown>;
	if (typeof data === "string") {
		obj = JSON.parse(data) as Record<string, unknown>;
	} else if (data && typeof data === "object") {
		obj = data as Record<string, unknown>;
	} else {
		throw new Error(`parseStatusEvent: expected string or object, got ${data === null ? "null" : typeof data}`);
	}
	if (typeof obj.kind !== "string" || obj.kind.length === 0) {
		throw new Error("parseStatusEvent: payload missing required `kind` field");
	}
	return obj as KernelStatusEvent;
}

/**
 * Execute a plugin-supplied snippet that prints the plugin's PreludeDocs
 * dict as a JSON object on stdout. Returns the parsed dict, or `null` if the
 * kernel errors, the snippet produces no output, or the output isn't valid
 * JSON — plugins without a prelude dict just return null.
 */
export async function introspectPreludeDocs(
	kernel: JupyterKernel,
	introspectSnippet: string,
	options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<PreludeDocs | null> {
	let output = "";
	const result = await kernel.execute(introspectSnippet, {
		silent: false,
		storeHistory: false,
		signal: options?.signal,
		timeoutMs: options?.timeoutMs,
		onChunk: text => {
			output += text;
		},
	});
	if (result.cancelled || result.status === "error") {
		return null;
	}
	const trimmed = output.trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed) as PreludeDocs;
	} catch {
		return null;
	}
}
