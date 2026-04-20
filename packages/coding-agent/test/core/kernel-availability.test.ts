import { describe, expect, test } from "bun:test";
import { listAvailableKernelspecs } from "../../src/kernel/availability";
import { isKernelspecAvailable } from "./helpers/kernel-available";

/**
 * These tests require Python + jupyter-kernel-gateway to be installed on the
 * host. When absent, the suite skips to keep local dev + CI environments
 * without a Python+jupyter toolchain green. To enable:
 *   pip install jupyter-kernel-gateway
 */
const available = await isKernelspecAvailable("python3");

describe.if(available)("listAvailableKernelspecs", () => {
	test("returns at least python3 on a system with Python installed", async () => {
		const specs = await listAvailableKernelspecs();
		expect(Array.isArray(specs)).toBe(true);
		expect(specs.some(s => s.name === "python3")).toBe(true);
	}, 30_000);

	test("returns KernelspecInfo entries with name, language, displayName", async () => {
		const specs = await listAvailableKernelspecs();
		for (const spec of specs) {
			expect(typeof spec.name).toBe("string");
			expect(typeof spec.language).toBe("string");
			expect(typeof spec.displayName).toBe("string");
		}
	});

	test("returns a sorted list of unique names", async () => {
		const specs = await listAvailableKernelspecs();
		const names = specs.map(s => s.name);
		const sorted = [...names].sort((a, b) => a.localeCompare(b));
		expect(names).toEqual(sorted);
		expect(new Set(names).size).toBe(names.length);
	});

	test("caches within the process (second call is much faster)", async () => {
		await listAvailableKernelspecs();
		const t1 = performance.now();
		await listAvailableKernelspecs();
		const cachedMs = performance.now() - t1;
		expect(cachedMs).toBeLessThan(5);
	});
});

describe.if(!available)("listAvailableKernelspecs (no python3 kernelspec)", () => {
	test("returns an array (may be empty if no kernelspecs registered)", async () => {
		try {
			const specs = await listAvailableKernelspecs();
			expect(Array.isArray(specs)).toBe(true);
		} catch (err) {
			expect(String(err)).toMatch(/jupyter/);
		}
	});
});
