/**
 * Shared test helper: check whether a given kernelspec is installed so test
 * suites can skip-guard tests that need a live kernel. Uses the same
 * process-lifetime cache as the SDK's listAvailableKernelspecs, so importing
 * this across multiple test files does not trigger multiple subprocess spawns.
 */

import { listAvailableKernelspecs } from "../../../src/kernel/availability";
import { createJupyterKernel } from "../../../src/kernel/jupyter-kernel";

export async function isKernelspecAvailable(name: string): Promise<boolean> {
	try {
		const specs = await listAvailableKernelspecs();
		return specs.some(spec => spec.name === name);
	} catch {
		return false;
	}
}

/**
 * Resolve the first kernelspec from a candidate list that is actually
 * installed. iruby's kernelspec name tracks the Ruby major version — "ruby"
 * on Ruby 2.x, "ruby4" on Ruby 4.x — so the smoke test picks whichever is
 * available.
 */
export async function pickKernelspec(candidates: readonly string[]): Promise<string | undefined> {
	try {
		const specs = await listAvailableKernelspecs();
		const names = new Set(specs.map(s => s.name));
		return candidates.find(c => names.has(c));
	} catch {
		return undefined;
	}
}

/**
 * Start a kernel for the given kernelspec to verify it can actually boot.
 * Returns true if the kernel reaches execute-ready within the timeout, false
 * otherwise. Use to skip smoke tests when a kernelspec is registered but its
 * underlying toolchain is broken (e.g., iruby without a resolvable libzmq).
 *
 * Memoised per-process per-kernelspec: every test file that calls this for
 * the same kernelspec shares one boot check (~8s on first call, 0ms after).
 */
const startCache = new Map<string, Promise<boolean>>();
export function canStartKernel(kernelspec: string, timeoutMs = 8_000): Promise<boolean> {
	let cached = startCache.get(kernelspec);
	if (!cached) {
		cached = (async () => {
			let kernel: Awaited<ReturnType<typeof createJupyterKernel>> | undefined;
			try {
				const deadlineMs = Date.now() + timeoutMs;
				kernel = await createJupyterKernel({ kernelspec, deadlineMs });
				const remaining = Math.max(1_000, deadlineMs - Date.now());
				// Connecting to the gateway can succeed before the kernel has
				// actually loaded its runtime (iruby hangs on missing libzmq
				// without rejecting the WebSocket). Execute a trivial cell so
				// "startable" means "can run code", not "answered the socket".
				const result = await kernel.execute("", { timeoutMs: remaining });
				return result.status === "ok";
			} catch {
				return false;
			} finally {
				await kernel?.shutdown().catch(() => undefined);
			}
		})();
		startCache.set(kernelspec, cached);
	}
	return cached;
}
