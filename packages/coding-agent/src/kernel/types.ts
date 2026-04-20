/**
 * Public type surface for the kernel SDK. Plugins import these types via
 * `@oh-my-pi/pi-coding-agent` to build kernels for languages other than Python.
 *
 * Shapes that predate the SDK (KernelDisplayOutput, KernelExecuteOptions,
 * KernelExecuteResult, JupyterHeader, JupyterMessage, PythonStatusEvent,
 * KernelLifecycleOptions, KernelShutdownOptions, KernelShutdownResult,
 * ExternalGatewayConfig) live alongside their implementation in
 * ./jupyter-kernel.ts and are re-exported here.
 *
 * New types added for the plugin SDK (KernelStatusEvent, PreludeDocs) are
 * declared here — the first canonical home is this file.
 */

export type { GatewayInfo, GatewayStatus } from "./gateway-coordinator";
export type {
	ExternalGatewayConfig,
	JupyterHeader,
	JupyterMessage,
	KernelDisplayOutput,
	KernelExecuteOptions,
	KernelExecuteResult,
	KernelLifecycleOptions,
	KernelShutdownOptions,
	KernelShutdownResult,
	PythonStatusEvent,
} from "./jupyter-kernel";

/**
 * Cross-language status event for plugin kernels. Emitted via
 * `application/x-omp-status` display_data messages. `kind` is the
 * discriminant; Python's in-core prelude uses the legacy `op` field
 * (see `PythonStatusEvent`).
 */
export interface KernelStatusEvent {
	kind: string;
	message?: string;
	progress?: number;
	[key: string]: unknown;
}

/**
 * Shape of the plugin's prelude documentation dict. Plugins place an instance
 * of this shape at a well-known name in the kernel runtime and supply a
 * language-specific snippet to introspect it.
 */
export interface PreludeDocs {
	overview?: string;
	examples?: ReadonlyArray<{ title?: string; code: string }>;
	helpers?: Record<string, string>;
	[key: string]: unknown;
}
