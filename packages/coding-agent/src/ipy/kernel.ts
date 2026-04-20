/**
 * @deprecated Backward-compat re-export barrel.
 * Import directly from "../kernel/jupyter-kernel" (protocol types) or
 * "./python-kernel" (Python-specific class) in new code.
 */

// Protocol-core types and utilities from kernel/jupyter-kernel.ts
export type {
	JupyterHeader,
	JupyterMessage,
	KernelDisplayOutput,
	KernelExecuteOptions,
	KernelExecuteResult,
	KernelLifecycleOptions,
	KernelShutdownOptions,
	KernelShutdownResult,
	PythonStatusEvent,
} from "../kernel/jupyter-kernel";
export {
	deserializeWebSocketMessage,
	renderKernelDisplay,
	serializeWebSocketMessage,
} from "../kernel/jupyter-kernel";

// Python-specific exports from ipy/python-kernel.ts
export type { PreludeHelper, PythonKernelAvailability } from "./python-kernel";
export { checkPythonKernelAvailability, PythonKernel } from "./python-kernel";
