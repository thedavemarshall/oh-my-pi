import { describe, expect, it } from "bun:test";
import type { AskHandlerAnswer, AskHandlerQuestion } from "../../src/tools";

describe("AskProxyTool", () => {
	it("delegates single question to askHandler and formats response", async () => {
		const { AskProxyTool } = await import("../../src/tools/ask-proxy");

		const receivedQuestions: AskHandlerQuestion[][] = [];
		const mockSession = {
			askHandler: async (questions: AskHandlerQuestion[]): Promise<AskHandlerAnswer[]> => {
				receivedQuestions.push(questions);
				return [{ id: "auth", selectedOptions: ["JWT"], customInput: undefined }];
			},
			settings: { get: () => "" },
		} as any;

		const tool = new AskProxyTool(mockSession);
		const result = await tool.execute("call-1", {
			questions: [
				{
					id: "auth",
					question: "Which auth method?",
					options: [{ label: "JWT" }, { label: "OAuth2" }],
				},
			],
		});

		expect(receivedQuestions).toHaveLength(1);
		expect(receivedQuestions[0][0].question).toBe("Which auth method?");
		expect(receivedQuestions[0][0].options).toEqual(["JWT", "OAuth2"]);
		expect(result.content[0].text).toContain("User selected: JWT");
	});

	it("formats multi-question responses", async () => {
		const { AskProxyTool } = await import("../../src/tools/ask-proxy");

		const mockSession = {
			askHandler: async (questions: AskHandlerQuestion[]): Promise<AskHandlerAnswer[]> => {
				return questions.map(q => ({
					id: q.id,
					selectedOptions: [q.options[0]],
				}));
			},
			settings: { get: () => "" },
		} as any;

		const tool = new AskProxyTool(mockSession);
		const result = await tool.execute("call-2", {
			questions: [
				{ id: "q1", question: "First?", options: [{ label: "A" }, { label: "B" }] },
				{ id: "q2", question: "Second?", options: [{ label: "X" }, { label: "Y" }] },
			],
		});

		expect(result.content[0].text).toContain("User answers:");
		expect(result.content[0].text).toContain("First?");
		expect(result.content[0].text).toContain("Second?");
	});

	it("handles custom input from handler", async () => {
		const { AskProxyTool } = await import("../../src/tools/ask-proxy");

		const mockSession = {
			askHandler: async (): Promise<AskHandlerAnswer[]> => {
				return [{ id: "q1", selectedOptions: [], customInput: "my custom answer" }];
			},
			settings: { get: () => "" },
		} as any;

		const tool = new AskProxyTool(mockSession);
		const result = await tool.execute("call-3", {
			questions: [{ id: "q1", question: "What?", options: [{ label: "A" }] }],
		});

		expect(result.content[0].text).toContain("User provided custom input: my custom answer");
	});

	it("returns error when aborted via signal", async () => {
		const { AskProxyTool } = await import("../../src/tools/ask-proxy");

		const controller = new AbortController();
		controller.abort();

		const mockSession = {
			askHandler: async (): Promise<AskHandlerAnswer[]> => {
				throw new Error("should not be called");
			},
			settings: { get: () => "" },
		} as any;

		const tool = new AskProxyTool(mockSession);
		const result = await tool.execute(
			"call-4",
			{ questions: [{ id: "q1", question: "What?", options: [{ label: "A" }] }] },
			controller.signal,
		);

		expect(result.content[0].text).toContain("Error");
	});
});
