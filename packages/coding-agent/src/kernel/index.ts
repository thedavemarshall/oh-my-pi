/**
 * Public SDK surface for the Jupyter kernel protocol. Imported by out-of-repo
 * plugins that build kernels for languages other than Python — Ruby (iruby),
 * TypeScript (tslab), SQL, Rails console, etc.
 *
 * Python's in-core tool (tools/python.ts) uses the same surface via the
 * ipy/python-kernel.ts composition layer; it does not import from here to
 * avoid a circular barrel dependency.
 */

export { listAvailableKernelspecs } from "./availability";
export { type CellRunHandlers, runKernelCell } from "./cell-runner";
export { classifyKernelError, type KernelError } from "./error";
export { getGatewayStatus, shutdownSharedGateway } from "./gateway-coordinator";
export {
	type CreateKernelOptions,
	createJupyterKernel,
	JupyterKernel,
	type MimeHandler,
	renderKernelDisplay,
} from "./jupyter-kernel";
export { introspectPreludeDocs, OMP_STATUS_MIME, parseStatusEvent } from "./prelude-protocol";

export type {
	ExternalGatewayConfig,
	GatewayInfo,
	GatewayStatus,
	JupyterHeader,
	JupyterMessage,
	KernelDisplayOutput,
	KernelExecuteOptions,
	KernelExecuteResult,
	KernelLifecycleOptions,
	KernelShutdownOptions,
	KernelShutdownResult,
	KernelStatusEvent,
	PreludeDocs,
	PythonStatusEvent,
} from "./types";
