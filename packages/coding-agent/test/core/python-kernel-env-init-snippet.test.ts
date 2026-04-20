import { describe, expect, it } from "bun:test";
import { buildPythonEnvInitSnippet } from "@oh-my-pi/pi-coding-agent/ipy/python-kernel";

describe("buildPythonEnvInitSnippet", () => {
	it("produces a runnable snippet with cwd chdir, env assignment, and sys.path insert", () => {
		const snippet = buildPythonEnvInitSnippet("/work/proj", { FOO: "bar" });

		expect(snippet).toContain("import os, sys");
		expect(snippet).toContain('__omp_cwd = "/work/proj"');
		expect(snippet).toContain("os.chdir(__omp_cwd)");
		expect(snippet).toContain('__omp_env = {"FOO":"bar"}');
		expect(snippet).toContain("os.environ[__omp_key] = __omp_val");
		expect(snippet).toContain("sys.path.insert(0, __omp_cwd)");
	});

	it("emits an empty env dict when env is undefined", () => {
		const snippet = buildPythonEnvInitSnippet("/x");

		expect(snippet).toContain("__omp_env = {}");
	});

	it("filters undefined values from env map (does not emit literal undefined)", () => {
		const snippet = buildPythonEnvInitSnippet("/x", { KEEP: "1", DROP: undefined });

		expect(snippet).toContain('"KEEP":"1"');
		expect(snippet).not.toContain("DROP");
		expect(snippet).not.toContain("undefined");
	});

	it("safely escapes cwd containing quotes and backslashes via JSON.stringify", () => {
		const snippet = buildPythonEnvInitSnippet('/path/with "quotes"\\and\\slashes');

		expect(snippet).toContain('__omp_cwd = "/path/with \\"quotes\\"\\\\and\\\\slashes"');
	});

	it("safely escapes env values containing newlines and quotes", () => {
		const snippet = buildPythonEnvInitSnippet("/x", { MULTI: "line1\nline2", QUOTED: 'has "quote"' });

		expect(snippet).toContain('"MULTI":"line1\\nline2"');
		expect(snippet).toContain('"QUOTED":"has \\"quote\\""');
	});
});
