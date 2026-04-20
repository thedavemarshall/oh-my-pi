/**
 * Kernel lifecycle helpers — signal composition, deadline arithmetic, and
 * startup-failure triage. Pure utilities shared by JupyterKernel and
 * PythonKernel; no gateway or protocol dependencies.
 */

import { createCancellationError, getAbortReason, getExecutionCancellationError } from "./cancellation";

const STARTUP_CLEANUP_TIMEOUT_MS = 10_000;

export interface KernelLifecycleOptions {
	signal?: AbortSignal;
	deadlineMs?: number;
}

export interface KernelShutdownOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}

export interface KernelShutdownResult {
	confirmed: boolean;
}

/** Signature-compatible subset of KernelExecuteResult used by startup triage. */
interface StartupResultShape {
	cancelled: boolean;
	status: "ok" | "error";
	timedOut: boolean;
}

export function getRemainingTimeMs(deadlineMs?: number): number | undefined {
	if (deadlineMs === undefined) return undefined;
	return Math.max(0, deadlineMs - Date.now());
}

export function throwIfStartupExecutionFailed(
	result: StartupResultShape,
	signal: AbortSignal | undefined,
	failureMessage: string,
): void {
	if (result.cancelled) {
		throw getExecutionCancellationError(result, signal, failureMessage);
	}
	if (result.status === "error") {
		throw new Error(failureMessage);
	}
}

export function createAbortedSignal(reason: Error): AbortSignal {
	const controller = new AbortController();
	controller.abort(reason);
	return controller.signal;
}

export function combineAbortSignal(
	options: KernelLifecycleOptions,
	timeoutCapMs?: number,
	fallbackReason = "Operation aborted",
): AbortSignal | undefined {
	if (options.signal?.aborted) {
		return options.signal;
	}

	const signals: AbortSignal[] = [];
	if (options.signal) {
		signals.push(options.signal);
	}

	const remainingMs = getRemainingTimeMs(options.deadlineMs);
	const timeoutMs =
		remainingMs === undefined
			? timeoutCapMs
			: timeoutCapMs === undefined
				? remainingMs
				: Math.min(remainingMs, timeoutCapMs);

	if (timeoutMs !== undefined) {
		if (timeoutMs <= 0) {
			return createAbortedSignal(createCancellationError("TimeoutError", fallbackReason));
		}
		signals.push(AbortSignal.timeout(timeoutMs));
	}

	if (signals.length === 0) return undefined;
	return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

export function throwIfAborted(signal: AbortSignal | undefined, fallbackReason: string): void {
	if (!signal?.aborted) return;
	throw getAbortReason(signal, fallbackReason);
}

export function getStartupExecuteOptions(options: KernelLifecycleOptions): {
	signal: AbortSignal | undefined;
	timeoutMs: number | undefined;
} {
	return {
		signal: combineAbortSignal(options, undefined, "Python kernel startup aborted"),
		timeoutMs: getRemainingTimeMs(options.deadlineMs),
	};
}

export function getStartupCleanupTimeoutMs(deadlineMs?: number): number {
	const remainingMs = getRemainingTimeMs(deadlineMs);
	if (remainingMs === undefined || remainingMs <= 0) return STARTUP_CLEANUP_TIMEOUT_MS;
	return Math.min(STARTUP_CLEANUP_TIMEOUT_MS, remainingMs);
}
