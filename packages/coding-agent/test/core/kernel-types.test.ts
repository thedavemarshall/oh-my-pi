import { describe, expect, test } from "bun:test";
import type {
	GatewayInfo,
	JupyterHeader,
	JupyterMessage,
	KernelDisplayOutput,
	KernelExecuteOptions,
	KernelExecuteResult,
	KernelStatusEvent,
	PreludeDocs,
} from "../../src/kernel/types";

describe("kernel/types public surface", () => {
	test("KernelExecuteOptions accepts the documented shape", () => {
		const opts: KernelExecuteOptions = {
			signal: new AbortController().signal,
			timeoutMs: 1000,
			silent: true,
			storeHistory: false,
		};
		expect(opts.timeoutMs).toBe(1000);
	});

	test("KernelExecuteResult carries status + Python-compat extras", () => {
		const result: KernelExecuteResult = {
			status: "ok",
			executionCount: 1,
			cancelled: false,
			timedOut: false,
			stdinRequested: false,
		};
		expect(result.status).toBe("ok");
	});

	test("KernelDisplayOutput is a discriminated union over type", () => {
		const a: KernelDisplayOutput = { type: "json", data: { x: 1 } };
		const b: KernelDisplayOutput = { type: "image", data: "abc", mimeType: "image/png" };
		const c: KernelDisplayOutput = { type: "markdown" };
		const d: KernelDisplayOutput = { type: "status", event: { op: "find" } };
		expect([a, b, c, d].length).toBe(4);
	});

	test("KernelStatusEvent requires kind + allows arbitrary extras", () => {
		const ev: KernelStatusEvent = { kind: "query_start", phase: "parse", rowsProcessed: 42 };
		expect(ev.kind).toBe("query_start");
		expect(ev.phase).toBe("parse");
	});

	test("PreludeDocs allows overview, examples, helpers", () => {
		const docs: PreludeDocs = {
			overview: "Ruby kernel",
			examples: [{ title: "basic", code: "puts 'hi'" }],
			helpers: { status: "call status(kind, message)" },
		};
		expect(docs.overview).toBe("Ruby kernel");
	});

	test("JupyterMessage carries channel + header + content", () => {
		const header: JupyterHeader = {
			msg_id: "id",
			session: "s",
			username: "u",
			date: "d",
			msg_type: "m",
			version: "5.3",
		};
		const msg: JupyterMessage = {
			channel: "shell",
			header,
			parent_header: {},
			metadata: {},
			content: {},
		};
		expect(msg.channel).toBe("shell");
	});

	test("GatewayInfo describes a running gateway", () => {
		const info: GatewayInfo = {
			url: "http://localhost:8888",
			pid: 1,
			startedAt: Date.now(),
		};
		expect(info.url).toMatch(/^http/);
	});
});
