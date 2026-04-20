/**
 * Kernelspec availability helper.
 *
 * Queries `<python> -m jupyter kernelspec list --json` using the gateway
 * Python runtime. Returns rich metadata per kernelspec — name, language,
 * and display name — so plugins can filter by language rather than
 * hardcoding kernelspec-name candidate lists.
 *
 * Rationale (from live validation): iruby names its kernelspec `ruby<major>`
 * (ruby, ruby3, ruby4, ...) depending on which Ruby installs it. tslab
 * registers both `tslab` and `jslab`. A name-only API forces every plugin
 * to maintain brittle candidate lists; a language-keyed API lets the plugin
 * say "pick any installed ruby kernel" once and work across versions.
 *
 * Process-lifetime cached; restart to pick up newly-installed kernels.
 */

import { execCommand } from "../exec/exec";
import { resolvePythonRuntime } from "./gateway-runtime";

export interface KernelspecInfo {
	/** Kernelspec name passed to createJupyterKernel({ kernelspec }). */
	name: string;
	/** Jupyter-declared language (e.g., "python", "ruby", "typescript"). */
	language: string;
	/** Human-readable display name from the kernelspec metadata. */
	displayName: string;
}

let cache: Promise<KernelspecInfo[]> | null = null;

export function listAvailableKernelspecs(): Promise<KernelspecInfo[]> {
	if (cache) return cache;
	cache = loadKernelspecs().catch(err => {
		cache = null;
		throw err;
	});
	return cache;
}

async function loadKernelspecs(): Promise<KernelspecInfo[]> {
	const cwd = process.cwd();
	const runtime = resolvePythonRuntime(cwd, process.env);
	const result = await execCommand(runtime.pythonPath, ["-m", "jupyter", "kernelspec", "list", "--json"], cwd).catch(
		(err: Error) => {
			throw new Error(
				`jupyter kernelspec list failed to spawn: ${err.message}. ` +
					`Install Python + jupyter-kernel-gateway to enable kernel plugins.`,
			);
		},
	);
	if (result.code !== 0) {
		throw new Error(`jupyter kernelspec list exited ${result.code}: ${result.stderr.trim()}`);
	}
	const parsed = JSON.parse(result.stdout) as {
		kernelspecs?: Record<string, { spec?: { language?: string; display_name?: string } }>;
	};
	if (!parsed.kernelspecs) return [];
	return Object.entries(parsed.kernelspecs)
		.map(([name, entry]) => ({
			name,
			language: entry.spec?.language ?? "",
			displayName: entry.spec?.display_name ?? name,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}
