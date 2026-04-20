import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createJupyterKernel, runKernelCell } from "../../src/kernel";
import type { JupyterKernel } from "../../src/kernel/jupyter-kernel";
import type { PythonStatusEvent } from "../../src/kernel/types";
import { isKernelspecAvailable } from "./helpers/kernel-available";

const available = await isKernelspecAvailable("tslab");

describe.if(available)("JupyterKernel contract — typescript (tslab)", () => {
	let kernel: JupyterKernel | undefined;

	beforeAll(async () => {
		kernel = await createJupyterKernel({ kernelspec: "tslab" });
	}, 60_000);

	afterAll(async () => {
		if (kernel) await kernel.shutdown();
	}, 30_000);

	test("executes a simple TypeScript cell", async () => {
		let output = "";
		const result = await kernel!.execute("console.log(2 + 2);", {
			onChunk: text => {
				output += text;
			},
		});
		expect(result.status).toBe("ok");
		expect(output).toMatch(/4/);
	}, 30_000);

	// Status test must run before the error test: tslab's import recovery
	// is broken after an uncaught throw, so `import { display } from "tslab"`
	// silently no-ops in subsequent cells.
	test("x-omp-status MIME is surfaced as a status event", async () => {
		const events: PythonStatusEvent[] = [];
		await runKernelCell(
			kernel!,
			`import { display } from "tslab";
display.raw("application/x-omp-status", JSON.stringify({ kind: "ping" }));`,
			{
				onDisplay: output => {
					if (output.type === "status") events.push(output.event);
				},
			},
		);
		expect(events.some(e => (e as { kind?: string }).kind === "ping")).toBe(true);
	}, 30_000);

	test("surfaces errors", async () => {
		const result = await kernel!.execute("throw new Error('boom');");
		expect(result.status).toBe("error");
	}, 30_000);
});

describe.if(!available)("JupyterKernel contract — typescript (tslab) [skipped]", () => {
	test("tslab kernelspec not installed — smoke test skipped", () => {
		expect(true).toBe(true);
	});
});
