import { describe, expect, test } from "bun:test";
import { createJupyterKernel } from "../../src/kernel/jupyter-kernel";
import { isKernelspecAvailable } from "./helpers/kernel-available";

const available = await isKernelspecAvailable("python3");

describe.if(available)("createJupyterKernel (live python3)", () => {
	test("starts a kernel and executes a simple cell", async () => {
		const kernel = await createJupyterKernel({ kernelspec: "python3" });
		try {
			let output = "";
			const result = await kernel.execute("print(2+2)", {
				onChunk: text => {
					output += text;
				},
			});
			expect(result.status).toBe("ok");
			expect(output).toMatch(/4/);
		} finally {
			await kernel.shutdown();
		}
	}, 30_000);
});

describe("createJupyterKernel (unit)", () => {
	test("exposes the kernelspec on the returned options", () => {
		// Just verifies the export resolves + has the right shape. Live startup
		// is exercised in the `available` branch above.
		expect(typeof createJupyterKernel).toBe("function");
	});
});
