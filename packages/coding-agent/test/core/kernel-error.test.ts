import { describe, expect, it } from "bun:test";
import { classifyKernelError } from "@oh-my-pi/pi-coding-agent/kernel/error";

describe("classifyKernelError", () => {
	it("extracts ename, evalue, and traceback from a well-formed payload", () => {
		const error = classifyKernelError({
			ename: "ValueError",
			evalue: "invalid literal",
			traceback: ["Traceback (most recent call last):", "  File ...", "ValueError: invalid literal"],
		});

		expect(error.name).toBe("ValueError");
		expect(error.value).toBe("invalid literal");
		expect(error.traceback).toEqual([
			"Traceback (most recent call last):",
			"  File ...",
			"ValueError: invalid literal",
		]);
	});

	it("defaults missing ename to 'Error' and missing evalue to ''", () => {
		const error = classifyKernelError({});

		expect(error.name).toBe("Error");
		expect(error.value).toBe("");
		expect(error.traceback).toEqual([]);
	});

	it("returns empty traceback when traceback field is not an array", () => {
		const error = classifyKernelError({ ename: "TypeError", evalue: "x", traceback: "not an array" });

		expect(error.traceback).toEqual([]);
	});

	it("coerces non-string traceback entries to strings", () => {
		const error = classifyKernelError({ traceback: ["line one", 42, null, { a: 1 }] });

		expect(error.traceback).toEqual(["line one", "42", "null", "[object Object]"]);
	});

	it("handles null and undefined content without throwing", () => {
		expect(classifyKernelError(null)).toEqual({ name: "Error", value: "", traceback: [] });
		expect(classifyKernelError(undefined)).toEqual({ name: "Error", value: "", traceback: [] });
	});

	it("coerces non-string ename and evalue to strings", () => {
		const error = classifyKernelError({ ename: 500, evalue: { msg: "boom" } });

		expect(error.name).toBe("500");
		expect(error.value).toBe("[object Object]");
	});
});
