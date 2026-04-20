/**
 * JupyterKernel — language-agnostic client for a kernel hosted by
 * jupyter-kernel-gateway. Speaks the Jupyter wire protocol over WebSocket.
 */

import { $env, $flag, logger, Snowflake } from "@oh-my-pi/pi-utils";
import { getAbortReason } from "./cancellation";
import { type MimeHandler, renderKernelDisplay } from "./display";
import { classifyKernelError, type KernelError } from "./error";
import { acquireSharedGateway, releaseSharedGateway, shutdownSharedGateway } from "./gateway-coordinator";
import {
	combineAbortSignal,
	getStartupCleanupTimeoutMs,
	getStartupExecuteOptions,
	type KernelLifecycleOptions,
	type KernelShutdownOptions,
	type KernelShutdownResult,
	throwIfAborted,
	throwIfStartupExecutionFailed,
} from "./kernel-lifecycle";
import {
	deserializeWebSocketMessage,
	type JupyterHeader,
	type JupyterMessage,
	serializeWebSocketMessage,
} from "./wire-protocol";

const TRACE_IPC = $flag("PI_PYTHON_IPC_TRACE");

class SharedGatewayCreateError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

export interface ExternalGatewayConfig {
	url: string;
	token?: string;
}

export function getExternalGatewayConfig(): ExternalGatewayConfig | null {
	const url = $env.PI_PYTHON_GATEWAY_URL;
	if (!url) return null;
	return {
		url: url.replace(/\/$/, ""),
		token: $env.PI_PYTHON_GATEWAY_TOKEN,
	};
}

const WEBSOCKET_CONNECT_TIMEOUT_MS = 10_000;

// Re-export lifecycle types for callers that import from this module.
export type { KernelLifecycleOptions, KernelShutdownOptions, KernelShutdownResult } from "./kernel-lifecycle";
export { getStartupCleanupTimeoutMs } from "./kernel-lifecycle";

/**
 * Status event surfaced on the x-omp-status IOPub channel. Python's in-core
 * prelude uses the legacy `op` discriminator; plugin kernels use the
 * cross-language `kind` convention. Either field may be present.
 *
 * TODO(kernel-plugins): rename to a kernel-neutral identifier and move the
 * Python-specific naming out of kernel/.
 */
export interface PythonStatusEvent {
	op?: string;
	kind?: string;
	[key: string]: unknown;
}

export type KernelDisplayOutput =
	| { type: "json"; data: unknown }
	| { type: "image"; data: string; mimeType: string }
	| { type: "markdown" }
	| { type: "status"; event: PythonStatusEvent };

export interface KernelExecuteOptions {
	signal?: AbortSignal;
	onChunk?: (text: string) => Promise<void> | void;
	onDisplay?: (output: KernelDisplayOutput) => Promise<void> | void;
	timeoutMs?: number;
	silent?: boolean;
	storeHistory?: boolean;
	allowStdin?: boolean;
}

export interface KernelExecuteResult {
	status: "ok" | "error";
	executionCount?: number;
	error?: { name: string; value: string; traceback: string[] };
	cancelled: boolean;
	timedOut: boolean;
	stdinRequested: boolean;
}

interface JupyterKernelStartOptions extends KernelLifecycleOptions {
	kernelspec: string;
	prelude?: string;
	cwd: string;
	useSharedGateway?: boolean;
}

export { type MimeHandler, renderKernelDisplay } from "./display";
export {
	deserializeWebSocketMessage,
	type JupyterHeader,
	type JupyterMessage,
	serializeWebSocketMessage,
} from "./wire-protocol";

/**
 * Public factory for creating a kernel for a given kernelspec. Plugins call
 * this from out-of-repo packages to build kernels for Ruby (iruby),
 * TypeScript (tslab), SQL, Rails console, etc. Under the hood it acquires
 * the shared gateway and starts a kernel via JupyterKernel.start.
 */
export interface CreateKernelOptions extends KernelLifecycleOptions {
	/** Kernelspec name (e.g. "python3", "ruby", "tslab"). */
	kernelspec: string;
	/** Optional language-specific code to run at startup. */
	prelude?: string;
	/** Working directory for kernel session; defaults to process.cwd(). */
	cwd?: string;
}

export function createJupyterKernel(options: CreateKernelOptions): Promise<JupyterKernel> {
	return JupyterKernel.start({
		kernelspec: options.kernelspec,
		prelude: options.prelude,
		cwd: options.cwd ?? process.cwd(),
		signal: options.signal,
		deadlineMs: options.deadlineMs,
	});
}

export class JupyterKernel {
	readonly #authToken?: string;
	readonly #kernelspec: string;
	readonly #prelude: string;

	#ws: WebSocket | null = null;
	#disposed = false;
	#alive = true;
	#shutdownStarted = false;
	#shutdownConfirmed = false;
	#messageHandlers = new Map<string, (msg: JupyterMessage) => void>();
	#channelHandlers = new Map<string, Set<(msg: JupyterMessage) => void>>();
	#pendingExecutions = new Map<string, (reason: string) => void>();
	#mimeHandlers = new Map<string, MimeHandler>();

	private constructor(
		readonly id: string,
		readonly kernelId: string,
		readonly gatewayUrl: string,
		readonly sessionId: string,
		readonly username: string,
		readonly isSharedGateway: boolean,
		kernelspec: string,
		prelude: string,
		authToken?: string,
	) {
		this.#authToken = authToken;
		this.#kernelspec = kernelspec;
		this.#prelude = prelude;
	}

	#authHeaders(): Record<string, string> {
		if (!this.#authToken) return {};
		return { Authorization: `token ${this.#authToken}` };
	}

	#makeHeader(msgType: string, msgId: string = Snowflake.next()): JupyterHeader {
		return {
			msg_id: msgId,
			session: this.sessionId,
			username: this.username,
			date: new Date().toISOString(),
			msg_type: msgType,
			version: "5.5",
		};
	}

	/**
	 * Register a handler for a custom MIME type emitted by the kernel (e.g.,
	 * plugin-specific display_data bundles). The handler transforms the raw
	 * bundle into a `KernelDisplayOutput` that `renderKernelDisplay` already
	 * knows how to surface. Return `null` to pass through to default rendering.
	 *
	 * Per-kernel-instance scoping — two plugins can't clobber each other.
	 */
	registerMimeHandler(mimeType: string, handler: MimeHandler): void {
		this.#mimeHandlers.set(mimeType, handler);
	}

	get mimeHandlers(): ReadonlyMap<string, MimeHandler> {
		return this.#mimeHandlers;
	}

	static async start(options: JupyterKernelStartOptions): Promise<JupyterKernel> {
		const startup = { signal: options.signal, deadlineMs: options.deadlineMs };
		const startupSignal = combineAbortSignal(startup, undefined, "Kernel startup aborted");

		const externalConfig = getExternalGatewayConfig();
		if (externalConfig) {
			return JupyterKernel.#startWithExternalGateway(
				externalConfig,
				options.kernelspec,
				options.prelude ?? "",
				startup,
			);
		}

		if (options.useSharedGateway === false) {
			throw new Error("Shared gateway required; local gateways are disabled");
		}

		for (let attempt = 0; attempt < 2; attempt += 1) {
			throwIfAborted(startupSignal, "Kernel startup aborted");
			try {
				const sharedResult = await logger.time(
					"JupyterKernel.start:acquireSharedGateway",
					acquireSharedGateway,
					options.cwd,
				);
				if (!sharedResult) {
					throw new Error("Shared gateway unavailable");
				}
				const kernel = await logger.time(
					"JupyterKernel.start:startWithSharedGateway",
					JupyterKernel.#startWithSharedGateway,
					sharedResult.url,
					options.kernelspec,
					options.prelude ?? "",
					startup,
				);
				return kernel;
			} catch (err) {
				logger.debug("JupyterKernel.start:sharedFailed");
				if (attempt === 0 && err instanceof SharedGatewayCreateError && err.status >= 500) {
					logger.warn("Shared gateway kernel creation failed, retrying", {
						status: err.status,
					});
					continue;
				}
				logger.warn("Failed to acquire shared gateway", {
					error: err instanceof Error ? err.message : String(err),
				});
				throw err;
			}
		}

		throw new Error("Shared gateway unavailable after retry");
	}

	static async #startWithExternalGateway(
		config: ExternalGatewayConfig,
		kernelspec: string,
		prelude: string,
		startup: KernelLifecycleOptions = {},
	): Promise<JupyterKernel> {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (config.token) {
			headers.Authorization = `token ${config.token}`;
		}

		const startupSignal = combineAbortSignal(startup, undefined, "Kernel startup aborted");
		throwIfAborted(startupSignal, "Kernel startup aborted");
		const createResponse = await fetch(`${config.url}/api/kernels`, {
			method: "POST",
			headers,
			body: JSON.stringify({ name: kernelspec }),
			signal: startupSignal,
		});

		if (!createResponse.ok) {
			throw new Error(`Failed to create kernel on external gateway: ${await createResponse.text()}`);
		}

		const kernelInfo = (await createResponse.json()) as { id: string };
		const kernelId = kernelInfo.id;

		const kernel = new JupyterKernel(
			Snowflake.next(),
			kernelId,
			config.url,
			Snowflake.next(),
			"omp",
			false,
			kernelspec,
			prelude,
			config.token,
		);

		try {
			await kernel.#connectWebSocket(startup);
			if (prelude) {
				const preludeOptions = getStartupExecuteOptions(startup);
				const preludeResult = await kernel.execute(prelude, {
					...preludeOptions,
					silent: true,
					storeHistory: false,
				});
				throwIfStartupExecutionFailed(preludeResult, preludeOptions.signal, "Failed to initialize kernel prelude");
			}
			return kernel;
		} catch (err: unknown) {
			await kernel.shutdown({ timeoutMs: getStartupCleanupTimeoutMs(startup.deadlineMs) });
			throw err;
		}
	}

	static async #startWithSharedGateway(
		gatewayUrl: string,
		kernelspec: string,
		prelude: string,
		startup: KernelLifecycleOptions = {},
	): Promise<JupyterKernel> {
		const startupSignal = combineAbortSignal(startup, undefined, "Kernel startup aborted");
		throwIfAborted(startupSignal, "Kernel startup aborted");
		const createResponse = await logger.time(
			"startWithSharedGateway:createKernel",
			fetch,
			`${gatewayUrl}/api/kernels`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: kernelspec }),
				signal: startupSignal,
			},
		);

		if (!createResponse.ok) {
			logger.debug(`sharedGateway:fetch:notOk:${createResponse.status}`);
			await shutdownSharedGateway();
			const text = await createResponse.text();
			throw new SharedGatewayCreateError(
				createResponse.status,
				`Failed to create kernel on shared gateway: ${text}`,
			);
		}

		const kernelInfo = (await logger.time(
			"startWithSharedGateway:parseJson",
			createResponse.json.bind(createResponse),
		)) as { id: string };
		const kernelId = kernelInfo.id;

		const kernel = new JupyterKernel(
			Snowflake.next(),
			kernelId,
			gatewayUrl,
			Snowflake.next(),
			"omp",
			true,
			kernelspec,
			prelude,
		);

		try {
			await logger.time("startWithSharedGateway:connectWS", kernel.#connectWebSocket.bind(kernel), startup);
			if (prelude) {
				const preludeOptions = getStartupExecuteOptions(startup);
				const preludeResult = await logger.time(
					"startWithSharedGateway:prelude",
					kernel.execute.bind(kernel),
					prelude,
					{
						...preludeOptions,
						silent: true,
						storeHistory: false,
					},
				);
				throwIfStartupExecutionFailed(preludeResult, preludeOptions.signal, "Failed to initialize kernel prelude");
			}
			return kernel;
		} catch (err: unknown) {
			await kernel.shutdown({ timeoutMs: getStartupCleanupTimeoutMs(startup.deadlineMs) });
			throw err;
		}
	}

	async #connectWebSocket(options: KernelLifecycleOptions = {}): Promise<void> {
		const wsBase = this.gatewayUrl.replace(/^http/, "ws");
		let wsUrl = `${wsBase}/api/kernels/${this.kernelId}/channels`;
		if (this.#authToken) {
			wsUrl += `?token=${encodeURIComponent(this.#authToken)}`;
		}

		const connectSignal = combineAbortSignal(options, WEBSOCKET_CONNECT_TIMEOUT_MS, "WebSocket connection timeout");
		throwIfAborted(connectSignal, "WebSocket connection timeout");

		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const ws = new WebSocket(wsUrl);
		ws.binaryType = "arraybuffer";
		let settled = false;

		const finalize = (): void => {
			if (connectSignal) {
				connectSignal.removeEventListener("abort", onAbort);
			}
		};

		const onAbort = () => {
			ws.close();
			if (settled) return;
			settled = true;
			finalize();
			reject(getAbortReason(connectSignal, "WebSocket connection timeout"));
		};

		if (connectSignal) {
			connectSignal.addEventListener("abort", onAbort, { once: true });
		}

		ws.onopen = () => {
			if (settled) return;
			settled = true;
			finalize();
			this.#ws = ws;
			resolve();
		};

		ws.onerror = event => {
			const error = new Error(`WebSocket error: ${event}`);
			if (!settled) {
				settled = true;
				finalize();
				reject(error);
				return;
			}
			this.#alive = false;
			this.#ws = null;
			this.#abortPendingExecutions(error.message);
		};

		ws.onclose = () => {
			this.#alive = false;
			this.#ws = null;
			if (!settled) {
				settled = true;
				finalize();
				reject(new Error("WebSocket closed before connection"));
				return;
			}
			this.#abortPendingExecutions("WebSocket closed");
		};

		ws.onmessage = event => {
			let msg: JupyterMessage | null = null;
			if (event.data instanceof ArrayBuffer) {
				msg = deserializeWebSocketMessage(event.data);
			} else if (typeof event.data === "string") {
				try {
					msg = JSON.parse(event.data) as JupyterMessage;
				} catch {
					return;
				}
			}
			if (!msg) return;

			if (TRACE_IPC) {
				logger.debug("Kernel IPC recv", { channel: msg.channel, msgType: msg.header.msg_type });
			}

			const parentId = (msg.parent_header as { msg_id?: string }).msg_id;
			if (parentId) {
				const handler = this.#messageHandlers.get(parentId);
				if (handler) handler(msg);
			}

			const channelHandlers = this.#channelHandlers.get(msg.channel);
			if (channelHandlers) {
				for (const handler of channelHandlers) {
					handler(msg);
				}
			}
		};

		return promise;
	}

	#abortPendingExecutions(reason: string): void {
		if (this.#pendingExecutions.size === 0) return;
		for (const cancel of this.#pendingExecutions.values()) {
			cancel(reason);
		}
		this.#pendingExecutions.clear();
		this.#messageHandlers.clear();
		logger.warn("Aborted pending kernel executions", { reason });
	}

	isAlive(): boolean {
		return this.#alive && !this.#disposed && this.#ws?.readyState === WebSocket.OPEN;
	}

	/**
	 * Round-trip probe: verifies the kernel can run code, not just that the
	 * socket is accepting. jupyter-kernel-gateway opens the WebSocket before
	 * the kernel's language runtime is ready, so a dead kernel can still
	 * report connected. Callers that need to gate UI on "working" (rather
	 * than "connected") should prefer this over isAlive().
	 *
	 * The narrow error shape is intentional — callers that want structured
	 * errors with tracebacks should call execute() and inspect result.error.
	 */
	async healthCheck(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<{
		ok: boolean;
		latencyMs: number;
		error?: { name: string; message: string };
	}> {
		const start = Date.now();
		try {
			const result = await this.execute("", {
				signal: options?.signal,
				timeoutMs: options?.timeoutMs ?? 10_000,
				silent: true,
				storeHistory: false,
			});
			return {
				ok: result.status === "ok" && !result.cancelled && !result.timedOut,
				latencyMs: Date.now() - start,
				error: result.error ? { name: result.error.name, message: result.error.value } : undefined,
			};
		} catch (err) {
			return {
				ok: false,
				latencyMs: Date.now() - start,
				error: {
					name: err instanceof Error ? err.name : "Error",
					message: err instanceof Error ? err.message : String(err),
				},
			};
		}
	}

	async execute(code: string, options?: KernelExecuteOptions): Promise<KernelExecuteResult> {
		if (!this.isAlive()) {
			throw new Error("Kernel is not running");
		}

		const msgId = Snowflake.next();
		const msg: JupyterMessage = {
			channel: "shell",
			header: this.#makeHeader("execute_request", msgId),
			parent_header: {},
			metadata: {},
			content: {
				code,
				silent: options?.silent ?? false,
				store_history: options?.storeHistory ?? !(options?.silent ?? false),
				user_expressions: {},
				allow_stdin: options?.allowStdin ?? false,
				stop_on_error: true,
			},
		};

		let status: "ok" | "error" = "ok";
		let executionCount: number | undefined;
		let error: KernelError | undefined;
		let replyReceived = false;
		let idleReceived = false;
		let stdinRequested = false;
		let cancelled = false;
		let timedOut = false;

		const controller = new AbortController();
		const onAbort = () => {
			controller.abort(options?.signal?.reason ?? new Error("Aborted"));
		};
		if (options?.signal) {
			if (options.signal.aborted) {
				onAbort();
			} else {
				options.signal.addEventListener("abort", onAbort, { once: true });
			}
		}
		const timeoutId =
			typeof options?.timeoutMs === "number" && options.timeoutMs > 0
				? setTimeout(() => {
						timedOut = true;
						controller.abort(new Error("Timeout"));
					}, options.timeoutMs)
				: undefined;

		const { promise, resolve } = Promise.withResolvers<KernelExecuteResult>();

		let resolved = false;
		const finalize = () => {
			if (resolved) return;
			resolved = true;
			this.#messageHandlers.delete(msgId);
			this.#pendingExecutions.delete(msgId);
			if (timeoutId) clearTimeout(timeoutId);
			if (options?.signal) {
				options.signal.removeEventListener("abort", onAbort);
			}
			resolve({ status, executionCount, error, cancelled, timedOut, stdinRequested });
		};

		const checkDone = () => {
			if (replyReceived && idleReceived) {
				finalize();
			}
		};

		const cancelFromClose = (reason: string) => {
			if (resolved) return;
			cancelled = true;
			timedOut = false;
			if (options?.onChunk) {
				void options.onChunk(`[kernel] ${reason}\n`);
			}
			finalize();
		};

		this.#pendingExecutions.set(msgId, cancelFromClose);

		const onExecutionAbort = () => {
			cancelled = true;
			void (async () => {
				try {
					await this.interrupt();
				} finally {
					finalize();
				}
			})();
		};
		controller.signal.addEventListener("abort", onExecutionAbort, { once: true });

		if (controller.signal.aborted) {
			cancelFromClose("Execution aborted");
			return promise;
		}

		this.#messageHandlers.set(msgId, async response => {
			switch (response.header.msg_type) {
				case "execute_reply": {
					replyReceived = true;
					const replyStatus = response.content.status;
					status = replyStatus === "error" ? "error" : "ok";
					if (typeof response.content.execution_count === "number") {
						executionCount = response.content.execution_count;
					}
					checkDone();
					break;
				}
				case "stream": {
					const text = String(response.content.text ?? "");
					if (text && options?.onChunk) {
						await options.onChunk(text);
					}
					break;
				}
				case "execute_result":
				case "display_data": {
					const { text, outputs } = renderKernelDisplay(response.content, {
						handlers: this.#mimeHandlers,
					});
					if (text && options?.onChunk) {
						await options.onChunk(text);
					}
					if (outputs.length > 0 && options?.onDisplay) {
						for (const output of outputs) {
							await options.onDisplay(output);
						}
					}
					break;
				}
				case "error": {
					error = classifyKernelError(response.content);
					const text =
						error.traceback.length > 0 ? `${error.traceback.join("\n")}\n` : `${error.name}: ${error.value}\n`;
					if (options?.onChunk) {
						await options.onChunk(text);
					}
					break;
				}
				case "status": {
					const state = response.content.execution_state;
					if (state === "idle") {
						idleReceived = true;
						checkDone();
					}
					break;
				}
				case "input_request": {
					stdinRequested = true;
					if (options?.onChunk) {
						await options.onChunk(
							"[stdin] Kernel requested input. Interactive stdin is not supported; provide input programmatically.\n",
						);
					}
					this.#sendMessage({
						channel: "stdin",
						header: this.#makeHeader("input_reply"),
						parent_header: response.header as unknown as Record<string, unknown>,
						metadata: {},
						content: { value: "" },
					});
					break;
				}
			}
		});

		try {
			this.#sendMessage(msg);
		} catch {
			cancelled = true;
			finalize();
		}
		return promise;
	}

	async interrupt(): Promise<void> {
		try {
			await fetch(`${this.gatewayUrl}/api/kernels/${this.kernelId}/interrupt`, {
				method: "POST",
				headers: this.#authHeaders(),
				signal: AbortSignal.timeout(2000),
			});
		} catch (err: unknown) {
			logger.warn("Failed to interrupt kernel via API", { error: err instanceof Error ? err.message : String(err) });
		}

		try {
			const msg: JupyterMessage = {
				channel: "control",
				header: this.#makeHeader("interrupt_request"),
				parent_header: {},
				metadata: {},
				content: {},
			};
			this.#sendMessage(msg);
		} catch (err: unknown) {
			logger.warn("Failed to send interrupt request", { error: err instanceof Error ? err.message : String(err) });
		}
	}

	async shutdown(options?: KernelShutdownOptions): Promise<KernelShutdownResult> {
		if (this.#shutdownConfirmed) return { confirmed: true };
		if (!this.#shutdownStarted) {
			this.#shutdownStarted = true;
			this.#alive = false;
			this.#abortPendingExecutions("Kernel shutdown");

			if (this.#ws) {
				this.#ws.close();
				this.#ws = null;
			}
		}

		const shutdownSignal = combineAbortSignal(
			{ signal: options?.signal },
			options?.timeoutMs,
			"Kernel shutdown timed out",
		);

		let confirmed = false;
		try {
			const response = await fetch(`${this.gatewayUrl}/api/kernels/${this.kernelId}`, {
				method: "DELETE",
				headers: this.#authHeaders(),
				signal: shutdownSignal,
			});
			const deleteConfirmed = response.status === 404 || response.status === 410;
			confirmed = response.ok || deleteConfirmed;
			if (!confirmed) {
				logger.warn("Kernel delete request was not confirmed", {
					status: response.status,
					statusText: response.statusText,
				});
			}
		} catch (err: unknown) {
			logger.warn("Failed to delete kernel via API", { error: err instanceof Error ? err.message : String(err) });
		}
		this.#shutdownConfirmed = confirmed;
		this.#disposed = confirmed;

		if (this.isSharedGateway) {
			try {
				await releaseSharedGateway();
			} catch (err: unknown) {
				logger.warn("Failed to release shared gateway after kernel shutdown", {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		return { confirmed };
	}

	#sendMessage(msg: JupyterMessage): void {
		if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
			throw new Error("WebSocket not connected");
		}

		if (TRACE_IPC) {
			logger.debug("Kernel IPC send", {
				channel: msg.channel,
				msgType: msg.header.msg_type,
				msgId: msg.header.msg_id,
			});
		}

		const payload = {
			channel: msg.channel,
			header: msg.header,
			parent_header: msg.parent_header,
			metadata: msg.metadata,
			content: msg.content,
		};
		if (msg.buffers && msg.buffers.length > 0) {
			this.#ws.send(serializeWebSocketMessage(msg));
			return;
		}
		this.#ws.send(JSON.stringify(payload));
	}
}
