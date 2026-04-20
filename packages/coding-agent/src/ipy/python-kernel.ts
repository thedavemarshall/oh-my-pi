/**
 * PythonKernel composes a JupyterKernel with the Python-specific prelude,
 * module discovery, and availability check. Core ships Python as the default
 * kernel; out-of-repo plugins compose their own (Ruby, TypeScript, SQL, ...).
 */

import { $flag, isBunTestRuntime, logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import { Settings } from "../config/settings";
import { filterEnv, resolvePythonRuntime } from "../kernel/gateway-runtime";
import {
	type ExternalGatewayConfig,
	getExternalGatewayConfig,
	getStartupCleanupTimeoutMs,
	JupyterKernel,
	type KernelExecuteOptions,
	type KernelExecuteResult,
	type KernelLifecycleOptions,
	type KernelShutdownOptions,
	type KernelShutdownResult,
} from "../kernel/jupyter-kernel";
import { loadPythonModules } from "./modules";
import { PYTHON_PRELUDE } from "./prelude";

export function buildPythonEnvInitSnippet(cwd: string, env?: Record<string, string | undefined>): string {
	const envEntries = Object.entries(env ?? {}).filter(([, value]) => value !== undefined);
	const envPayload = Object.fromEntries(envEntries);
	return [
		"import os, sys",
		`__omp_cwd = ${JSON.stringify(cwd)}`,
		"os.chdir(__omp_cwd)",
		`__omp_env = ${JSON.stringify(envPayload)}`,
		"for __omp_key, __omp_val in __omp_env.items():\n    os.environ[__omp_key] = __omp_val",
		"if __omp_cwd not in sys.path:\n    sys.path.insert(0, __omp_cwd)",
	].join("\n");
}

const PRELUDE_INTROSPECTION_SNIPPET = "import json\nprint(json.dumps(__omp_prelude_docs__()))";

export interface PreludeHelper {
	name: string;
	signature: string;
	docstring: string;
	category: string;
}

export interface PythonKernelAvailability {
	ok: boolean;
	pythonPath?: string;
	reason?: string;
}

export async function checkPythonKernelAvailability(cwd: string): Promise<PythonKernelAvailability> {
	if (isBunTestRuntime() || $flag("PI_PYTHON_SKIP_CHECK")) {
		return { ok: true };
	}

	const externalConfig = getExternalGatewayConfig();
	if (externalConfig) {
		return checkExternalGatewayAvailability(externalConfig);
	}

	try {
		const settings = await Settings.init();
		const { env } = settings.getShellConfig();
		const baseEnv = filterEnv(env);
		const runtime = resolvePythonRuntime(cwd, baseEnv);
		const checkScript =
			"import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('kernel_gateway') and importlib.util.find_spec('ipykernel') else 1)";
		const result = await $`${runtime.pythonPath} -c ${checkScript}`.quiet().nothrow().cwd(cwd).env(runtime.env);
		if (result.exitCode === 0) {
			return { ok: true, pythonPath: runtime.pythonPath };
		}
		return {
			ok: false,
			pythonPath: runtime.pythonPath,
			reason:
				"kernel_gateway (jupyter-kernel-gateway) or ipykernel not installed. Run: python -m pip install jupyter_kernel_gateway ipykernel",
		};
	} catch (err: unknown) {
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

async function checkExternalGatewayAvailability(config: ExternalGatewayConfig): Promise<PythonKernelAvailability> {
	try {
		const headers: Record<string, string> = {};
		if (config.token) {
			headers.Authorization = `token ${config.token}`;
		}

		const response = await fetch(`${config.url}/api/kernelspecs`, {
			headers,
			signal: AbortSignal.timeout(5000),
		});

		if (response.ok) {
			return { ok: true };
		}

		if (response.status === 401 || response.status === 403) {
			return {
				ok: false,
				reason: `External gateway at ${config.url} requires authentication. Set PI_PYTHON_GATEWAY_TOKEN.`,
			};
		}

		return {
			ok: false,
			reason: `External gateway at ${config.url} returned status ${response.status}`,
		};
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("abort") || message.includes("timeout")) {
			return {
				ok: false,
				reason: `External gateway at ${config.url} is not reachable (timeout)`,
			};
		}
		return {
			ok: false,
			reason: `External gateway at ${config.url} is not reachable: ${message}`,
		};
	}
}

interface PythonKernelStartOptions extends KernelLifecycleOptions {
	cwd: string;
	env?: Record<string, string | undefined>;
	useSharedGateway?: boolean;
}

/**
 * PythonKernel wraps JupyterKernel with Python-specific startup:
 * - kernelspec = "python3"
 * - PYTHON_PRELUDE injection
 * - Python module discovery via loadPythonModules
 * - Python availability checking
 */
export class PythonKernel {
	readonly #jupyter: JupyterKernel;

	private constructor(jupyter: JupyterKernel) {
		this.#jupyter = jupyter;
	}

	/** The underlying JupyterKernel — exposed for advanced callers (e.g. loadPythonModules). */
	get jupyter(): JupyterKernel {
		return this.#jupyter;
	}

	get id(): string {
		return this.#jupyter.id;
	}

	get kernelId(): string {
		return this.#jupyter.kernelId;
	}

	get gatewayUrl(): string {
		return this.#jupyter.gatewayUrl;
	}

	get sessionId(): string {
		return this.#jupyter.sessionId;
	}

	get username(): string {
		return this.#jupyter.username;
	}

	get isSharedGateway(): boolean {
		return this.#jupyter.isSharedGateway;
	}

	static async start(options: PythonKernelStartOptions): Promise<PythonKernel> {
		const availability = await logger.time(
			"PythonKernel.start:availabilityCheck",
			checkPythonKernelAvailability,
			options.cwd,
		);
		if (!availability.ok) {
			throw new Error(availability.reason ?? "Python kernel unavailable");
		}

		const envInitSnippet = buildPythonEnvInitSnippet(options.cwd, options.env);
		const combinedPrelude = `${envInitSnippet}\n${PYTHON_PRELUDE}`;
		const jupyter = await JupyterKernel.start({
			kernelspec: "python3",
			prelude: combinedPrelude,
			cwd: options.cwd,
			useSharedGateway: options.useSharedGateway,
			signal: options.signal,
			deadlineMs: options.deadlineMs,
		});

		// Python-specific module discovery (must run after kernel+prelude are ready)
		try {
			await loadPythonModules(jupyter, {
				cwd: options.cwd,
				signal: options.signal,
				deadlineMs: options.deadlineMs,
			});
		} catch (err) {
			await jupyter.shutdown({ timeoutMs: getStartupCleanupTimeoutMs(options.deadlineMs) });
			throw err;
		}

		return new PythonKernel(jupyter);
	}

	isAlive(): boolean {
		return this.#jupyter.isAlive();
	}

	execute(code: string, options?: KernelExecuteOptions): Promise<KernelExecuteResult> {
		return this.#jupyter.execute(code, options);
	}

	async introspectPrelude(options: Pick<KernelExecuteOptions, "signal" | "timeoutMs"> = {}): Promise<PreludeHelper[]> {
		let output = "";
		const result = await this.#jupyter.execute(PRELUDE_INTROSPECTION_SNIPPET, {
			silent: false,
			storeHistory: false,
			signal: options.signal,
			timeoutMs: options.timeoutMs,
			onChunk: text => {
				output += text;
			},
		});
		if (result.cancelled || result.status === "error") {
			throw new Error("Failed to introspect Python prelude");
		}
		const trimmed = output.trim();
		if (!trimmed) return [];
		try {
			return JSON.parse(trimmed) as PreludeHelper[];
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`Failed to parse Python prelude docs: ${message}`);
		}
	}

	interrupt(): Promise<void> {
		return this.#jupyter.interrupt();
	}

	shutdown(options?: KernelShutdownOptions): Promise<KernelShutdownResult> {
		return this.#jupyter.shutdown(options);
	}
}
