/**
 * runKernelCell — convenience wrapper around JupyterKernel.execute() that
 * separates text output from display objects and routes them to dedicated
 * callbacks. For finer control, call kernel.execute() directly.
 */

import type { JupyterKernel, KernelDisplayOutput, KernelExecuteOptions, KernelExecuteResult } from "./jupyter-kernel";

export interface CellRunHandlers {
	onText?: (text: string) => void | Promise<void>;
	onDisplay?: (output: KernelDisplayOutput) => void | Promise<void>;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export async function runKernelCell(
	kernel: JupyterKernel,
	code: string,
	handlers: CellRunHandlers = {},
): Promise<KernelExecuteResult> {
	const options: KernelExecuteOptions = {
		signal: handlers.signal,
		timeoutMs: handlers.timeoutMs,
	};
	if (handlers.onText) options.onChunk = handlers.onText;
	if (handlers.onDisplay) options.onDisplay = handlers.onDisplay;
	return kernel.execute(code, options);
}
