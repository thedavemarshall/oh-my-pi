import { describe, expect, test } from "bun:test";
import { renderKernelDisplay } from "../../src/kernel/display";
import type { MimeHandler } from "../../src/kernel/jupyter-kernel";

describe("MIME handler registry (via renderKernelDisplay)", () => {
	test("registered handler transforms unknown MIME into a known shape", () => {
		const handlers = new Map<string, MimeHandler>([["application/x-test", data => ({ type: "json", data })]]);

		const content = { data: { "application/x-test": { foo: 42 } } };
		const { outputs } = renderKernelDisplay(content, { handlers });

		expect(outputs).toEqual([{ type: "json", data: { foo: 42 } }]);
	});

	test("handler returning null falls through to default dispatch", () => {
		const handlers = new Map<string, MimeHandler>([["application/x-noop", () => null]]);

		const content = {
			data: {
				"application/x-noop": "ignored",
				"text/plain": "fallback",
			},
		};
		const { text, outputs } = renderKernelDisplay(content, { handlers });

		expect(text).toBe("fallback\n");
		expect(outputs).toEqual([]);
	});

	test("handler transforming to image adds to outputs", () => {
		const handlers = new Map<string, MimeHandler>([
			["application/x-chart", () => ({ type: "image", data: "base64data", mimeType: "image/png" })],
		]);

		const content = { data: { "application/x-chart": { chart: "spec" } } };
		const { outputs } = renderKernelDisplay(content, { handlers });

		expect(outputs).toEqual([{ type: "image", data: "base64data", mimeType: "image/png" }]);
	});

	test("absence of handlers preserves default behavior", () => {
		const content = { data: { "text/plain": "hi" } };
		const { text, outputs } = renderKernelDisplay(content);

		expect(text).toBe("hi\n");
		expect(outputs).toEqual([]);
	});
});
