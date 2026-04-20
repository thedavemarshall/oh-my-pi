import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createJupyterKernel, runKernelCell } from "../../src/kernel";
import type { JupyterKernel } from "../../src/kernel/jupyter-kernel";
import type { PythonStatusEvent } from "../../src/kernel/types";
import { canStartKernel, pickKernelspec } from "./helpers/kernel-available";

// Prefer ruby3 over ruby4: iruby 0.8.2 is broken on Ruby 4 because
// Binding#local_variable_set("_1", ...) conflicts with Ruby 4's numbered
// block parameters. Working Ruby 3 install takes precedence when both exist.
const kernelspec = await pickKernelspec(["ruby", "ruby3", "ruby4"]);
const available = kernelspec !== undefined && (await canStartKernel(kernelspec));

describe.if(available)("JupyterKernel contract — ruby (iruby)", () => {
	let kernel: JupyterKernel | undefined;

	beforeAll(async () => {
		kernel = await createJupyterKernel({ kernelspec: kernelspec! });
	}, 60_000);

	afterAll(async () => {
		if (kernel) await kernel.shutdown();
	}, 30_000);

	test("executes a simple cell", async () => {
		let output = "";
		const result = await kernel!.execute("puts 2 + 2", {
			onChunk: text => {
				output += text;
			},
		});
		expect(result.status).toBe("ok");
		expect(output).toMatch(/4/);
	}, 30_000);

	test("surfaces errors with classifyKernelError shape", async () => {
		const result = await kernel!.execute("raise 'boom'");
		expect(result.status).toBe("error");
		expect(result.error?.traceback.length ?? 0).toBeGreaterThan(0);
	}, 30_000);

	test("x-omp-status MIME is surfaced as a status event", async () => {
		const events: PythonStatusEvent[] = [];
		await runKernelCell(
			kernel!,
			`require 'json'
IRuby::Kernel.instance.session.send(:publish, :display_data, data: {"application/x-omp-status" => {kind: "ping"}.to_json}, metadata: {})
nil`,
			{
				onDisplay: output => {
					if (output.type === "status") events.push(output.event);
				},
			},
		);
		expect(events.some(e => (e as { kind?: string }).kind === "ping")).toBe(true);
	}, 30_000);
});

describe.if(!available)("JupyterKernel contract — ruby (iruby) [skipped]", () => {
	test("iruby kernelspec not installed — smoke test skipped", () => {
		expect(true).toBe(true);
	});
});
