import { describe, expect, test } from "bun:test";
import { OMP_STATUS_MIME, parseStatusEvent } from "../../src/kernel/prelude-protocol";
import type { KernelStatusEvent } from "../../src/kernel/types";

describe("prelude-protocol helpers", () => {
	test("OMP_STATUS_MIME is the documented constant", () => {
		expect(OMP_STATUS_MIME).toBe("application/x-omp-status");
	});

	test("parseStatusEvent accepts a JSON string payload", () => {
		const ev = parseStatusEvent('{"kind":"query_start","message":"parsing"}');
		expect(ev).toEqual({ kind: "query_start", message: "parsing" });
	});

	test("parseStatusEvent accepts an object payload", () => {
		const ev = parseStatusEvent({ kind: "query_done", progress: 1.0 });
		expect(ev).toEqual({ kind: "query_done", progress: 1.0 });
	});

	test("parseStatusEvent preserves extra fields", () => {
		const ev: KernelStatusEvent = parseStatusEvent({ kind: "ping", rowsProcessed: 42 });
		expect(ev.rowsProcessed).toBe(42);
	});

	test("parseStatusEvent throws on missing kind field", () => {
		expect(() => parseStatusEvent({ message: "no kind" })).toThrow(/kind/);
	});

	test("parseStatusEvent throws on null or non-object payloads", () => {
		expect(() => parseStatusEvent(null)).toThrow();
		expect(() => parseStatusEvent(42)).toThrow();
	});
});
