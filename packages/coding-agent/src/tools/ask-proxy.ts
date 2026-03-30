/**
 * Ask Proxy Tool - Delegates ask requests from headless subtasks to the parent UI.
 *
 * When a subtask session has an askHandler (provided by the parent executor),
 * this tool is registered instead of the full AskTool. It has the same schema
 * but delegates question display and input collection to the parent session.
 */
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { untilAborted } from "@oh-my-pi/pi-utils";
import { renderPromptTemplate } from "../config/prompt-templates";
import askDescription from "../prompts/tools/ask.md" with { type: "text" };
import type { AskHandlerAnswer, AskHandlerQuestion, ToolSession } from ".";
import { askSchema, type AskToolDetails, type AskToolInput, type QuestionResult } from "./ask";

export class AskProxyTool implements AgentTool<typeof askSchema, AskToolDetails> {
	readonly name = "ask";
	readonly label = "Ask";
	readonly description: string;
	readonly parameters = askSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {
		this.description = renderPromptTemplate(askDescription);
	}

	async execute(
		_toolCallId: string,
		params: AskToolInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<AskToolDetails>,
	): Promise<AgentToolResult<AskToolDetails>> {
		if (signal?.aborted) {
			// Error responses intentionally omit details — all AskToolDetails fields are optional
			return {
				content: [{ type: "text" as const, text: "Error: Ask was cancelled" }],
				details: {},
			};
		}

		if (params.questions.length === 0) {
			return {
				content: [{ type: "text" as const, text: "Error: questions must not be empty" }],
				details: {},
			};
		}

		const handler = this.session.askHandler;
		if (!handler) {
			return {
				content: [{ type: "text" as const, text: "Error: No ask handler available" }],
				details: {},
			};
		}

		const questions: AskHandlerQuestion[] = params.questions.map(q => ({
			id: q.id,
			question: q.question,
			options: q.options.map(o => o.label),
			multi: q.multi ?? false,
			recommended: q.recommended,
		}));

		let answers: AskHandlerAnswer[];
		try {
			answers = signal ? await untilAborted(signal, () => handler(questions)) : await handler(questions);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text" as const, text: `Error: Ask handler failed: ${message}` }],
				details: {},
			};
		}

		if (params.questions.length === 1) {
			const q = params.questions[0];
			const answer = answers[0];
			const optionLabels = q.options.map(o => o.label);
			const selectedOptions = answer?.selectedOptions ?? [];
			const customInput = answer?.customInput;

			const details: AskToolDetails = {
				question: q.question,
				options: optionLabels,
				multi: q.multi ?? false,
				selectedOptions,
				customInput,
			};

			return {
				content: [
					{ type: "text" as const, text: formatSingleAnswer(selectedOptions, customInput, q.multi ?? false) },
				],
				details,
			};
		}

		const results: QuestionResult[] = params.questions.map((q, i) => {
			const answer = answers[i];
			return {
				id: q.id,
				question: q.question,
				options: q.options.map(o => o.label),
				multi: q.multi ?? false,
				selectedOptions: answer?.selectedOptions ?? [],
				customInput: answer?.customInput,
			};
		});

		const details: AskToolDetails = { results };
		const responseLines = results.map(formatQuestionResult);
		const responseText = `User answers:\n${responseLines.join("\n")}`;

		return { content: [{ type: "text" as const, text: responseText }], details };
	}
}

function formatSingleAnswer(selectedOptions: string[], customInput: string | undefined, multi: boolean): string {
	const parts: string[] = [];
	if (selectedOptions.length > 0) {
		parts.push(multi ? `User selected: ${selectedOptions.join(", ")}` : `User selected: ${selectedOptions[0]}`);
	}
	if (customInput !== undefined) {
		parts.push(
			customInput.includes("\n")
				? `User provided custom input:\n${customInput
						.split("\n")
						.map(line => `  ${line}`)
						.join("\n")}`
				: `User provided custom input: ${customInput}`,
		);
	}
	return parts.length > 0 ? parts.join("\n") : "User cancelled the selection";
}

function formatQuestionResult(result: QuestionResult): string {
	const parts: string[] = [`- ${result.question}`];
	if (result.selectedOptions.length > 0) {
		parts.push(`  Selected: ${result.selectedOptions.join(", ")}`);
	}
	if (result.customInput !== undefined) {
		parts.push(`  Custom: ${result.customInput}`);
	}
	if (result.selectedOptions.length === 0 && result.customInput === undefined) {
		parts.push("  (no selection)");
	}
	return parts.join("\n");
}
