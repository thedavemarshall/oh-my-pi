/**
 * runKernelCell — convenience wrapper around JupyterKernel.execute() that
 * separates text output from display objects and routes them to dedicated
 * callbacks. Useful when you want a simpler interface than the full
 * onChunk/onDisplay callback pair.
 *
 * For callers that need the full control of onChunk + onDisplay, call
 * kernel.execute() directly.
 */

import type { JupyterKernel, KernelDisplayOutput, KernelExecuteOptions, KernelExecuteResult } from "./jupyter-kernel";

export interface CellRunHandlers {
	/** Called with each line of text output (stdout, stderr, repr, etc.) */
	onText?: (text: string) => void | Promise<void>;
	/** Called with each display object (images, JSON, markdown, status events) */
	onDisplay?: (output: KernelDisplayOutput) => void | Promise<void>;
	/** Optional abort signal to stop execution */
	signal?: AbortSignal;
	/** Optional timeout in milliseconds */
	timeoutMs?: number;
}

/**
 * Execute code on a kernel and route outputs to specialized callbacks.
 *
 * This is a convenience wrapper for the common case where you want to:
 * - Collect all text into onText()
 * - Route structured display outputs to onDisplay()
 * - Use standard signal/timeout handling
 *
 * @param kernel The JupyterKernel instance to execute on
 * @param code The Python/language code to execute
 * @param handlers Callback handlers for text and display outputs
 * @returns The underlying KernelExecuteResult (status, error, etc.)
 */
export async function runKernelCell(
	kernel: JupyterKernel,
	code: string,
	handlers: CellRunHandlers = {},
): Promise<KernelExecuteResult> {
	const options: KernelExecuteOptions = {
		signal: handlers.signal,
		timeoutMs: handlers.timeoutMs,
	};

	// If caller provided onText, collect all text (both streams and repr).
	if (handlers.onText) {
		options.onChunk = handlers.onText;
	}

	// If caller provided onDisplay, fan display outputs to the callback.
	if (handlers.onDisplay) {
		options.onDisplay = handlers.onDisplay;
	}

	return kernel.execute(code, options);
}
