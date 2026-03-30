import { describe, expect, it } from "bun:test";
import type { AskHandlerAnswer, AskHandlerQuestion } from "../../src/tools/index";
import { buildAskHandler } from "../../src/task/ask-handler";

function mockUI(options: { selectResponses: (string | undefined)[]; editorResponse?: string }) {
	let selectCallIndex = 0;
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	return {
		ui: {
			select: async (title: string, opts: string[]) => {
				selectCalls.push({ title, options: [...opts] });
				return options.selectResponses[selectCallIndex++];
			},
			editor: async () => options.editorResponse,
			theme: {
				checkbox: { checked: "[x]", unchecked: "[ ]" },
				status: { success: "[ok]" },
			},
		} as any,
		selectCalls,
	};
}

describe("buildAskHandler", () => {
	it("returns undefined when no UI and no parentAskHandler", () => {
		const handler = buildAskHandler(undefined, undefined);
		expect(handler).toBeUndefined();
	});

	it("single-select with recommended marks option and strips suffix", async () => {
		const { ui, selectCalls } = mockUI({ selectResponses: ["B (Recommended)"] });
		const handler = buildAskHandler(ui, undefined)!;
		expect(handler).toBeDefined();

		const answers = await handler([
			{ id: "q1", question: "Pick one", options: ["A", "B", "C"], multi: false, recommended: 1 },
		]);

		expect(selectCalls[0].options[1]).toBe("B (Recommended)");
		expect(answers[0].selectedOptions).toEqual(["B"]);
	});

	it("single-select returns empty selectedOptions on cancel", async () => {
		const { ui } = mockUI({ selectResponses: [undefined] });
		const handler = buildAskHandler(ui, undefined)!;

		const answers = await handler([
			{ id: "q1", question: "Pick one", options: ["A", "B"], multi: false },
		]);

		expect(answers[0].selectedOptions).toEqual([]);
	});

	it("multi-select with recommended marks option and strips suffix", async () => {
		const { ui, selectCalls } = mockUI({
			// First call: toggle "Alpha (Recommended)", second call: "Done selecting"
			selectResponses: ["[ ] Alpha (Recommended)", "[ok] Done selecting"],
		});
		const handler = buildAskHandler(ui, undefined)!;

		const answers = await handler([
			{ id: "q1", question: "Pick items", options: ["Alpha", "Beta"], multi: true, recommended: 0 },
		]);

		// The first select call should show Alpha with (Recommended) suffix
		const firstCallOpts = selectCalls[0].options;
		expect(firstCallOpts.some((o: string) => o.includes("Alpha (Recommended)"))).toBe(true);
		// The answer should have the suffix stripped
		expect(answers[0].selectedOptions).toEqual(["Alpha"]);
	});

	it("multi-select always shows Done selecting even with 0 selections", async () => {
		const { ui, selectCalls } = mockUI({
			selectResponses: ["[ok] Done selecting"],
		});
		const handler = buildAskHandler(ui, undefined)!;

		const answers = await handler([
			{ id: "q1", question: "Pick items", options: ["A", "B"], multi: true },
		]);

		// "Done selecting" should be present on the very first call (0 selections)
		expect(selectCalls[0].options.some((o: string) => o.includes("Done selecting"))).toBe(true);
		expect(answers[0].selectedOptions).toEqual([]);
	});

	it("multi-select handles Other (type your own) with editor", async () => {
		const { ui } = mockUI({
			selectResponses: ["Other (type your own)"],
			editorResponse: "custom text",
		});
		const handler = buildAskHandler(ui, undefined)!;

		const answers = await handler([
			{ id: "q1", question: "Pick items", options: ["A"], multi: true },
		]);

		expect(answers[0].customInput).toBe("custom text");
		expect(answers[0].selectedOptions).toEqual([]);
	});

	it("chains to parentAskHandler when no UI", async () => {
		const received: AskHandlerQuestion[][] = [];
		const parentHandler = async (questions: AskHandlerQuestion[]): Promise<AskHandlerAnswer[]> => {
			received.push(questions);
			return [{ id: "q1", selectedOptions: ["A"] }];
		};
		const handler = buildAskHandler(undefined, parentHandler)!;
		expect(handler).toBeDefined();

		const questions: AskHandlerQuestion[] = [
			{ id: "q1", question: "Pick", options: ["A", "B"], multi: false },
		];
		const answers = await handler(questions);

		expect(received).toHaveLength(1);
		expect(received[0]).toBe(questions);
		expect(answers[0].selectedOptions).toEqual(["A"]);
	});

	it("includes label in select prompt prefix", async () => {
		const { ui, selectCalls } = mockUI({ selectResponses: ["A"] });
		const handler = buildAskHandler(ui, undefined, "review")!;

		await handler([{ id: "q1", question: "Pick one", options: ["A"], multi: false }]);

		expect(selectCalls[0].title).toStartWith("[Subtask: review]");
	});

	it("defaults to [Subtask] prefix when no label provided", async () => {
		const { ui, selectCalls } = mockUI({ selectResponses: ["A"] });
		const handler = buildAskHandler(ui, undefined)!;

		await handler([{ id: "q1", question: "Pick one", options: ["A"], multi: false }]);

		expect(selectCalls[0].title).toStartWith("[Subtask]");
		expect(selectCalls[0].title).not.toContain("[Subtask:");
	});
});
