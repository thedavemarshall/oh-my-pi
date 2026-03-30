/**
 * Build an askHandler that proxies questions from a headless subtask to the parent UI.
 * Returns undefined when neither UI nor parent handler is available.
 *
 * Extracted from TaskTool to enable direct testing without circular dependency issues.
 */
import type { ExtensionUIContext } from "../extensibility/extensions/types";
import type { AskHandlerAnswer, AskHandlerQuestion, ToolSession } from "../tools/index";

export function buildAskHandler(
	ui: ExtensionUIContext | undefined,
	parentAskHandler: ToolSession["askHandler"],
	label?: string,
): ToolSession["askHandler"] {
	if (!ui && !parentAskHandler) return undefined;

	return async (questions: AskHandlerQuestion[]) => {
		const tag = label ? `[Subtask: ${label}]` : "[Subtask]";
		// If parent has direct UI, use it
		if (ui) {
			const answers: AskHandlerAnswer[] = [];
			for (const q of questions) {
				const originalOptions = [...q.options];
				const displayOptions = [...q.options];
				if (q.recommended !== undefined && q.recommended < displayOptions.length) {
					displayOptions[q.recommended] = `${displayOptions[q.recommended]} (Recommended)`;
				}
				if (q.multi) {
					// Multi-select: checkbox-toggle loop
					const { checkbox, status } = ui.theme;
					const selected = new Set<string>();
					let customInput: string | undefined;
					while (true) {
						const opts: string[] = displayOptions.map(
							opt => `${selected.has(opt) ? checkbox.checked : checkbox.unchecked} ${opt}`,
						);
						opts.push(`${status.success} Done selecting`);
						opts.push("Other (type your own)");
						const prefix = selected.size > 0 ? `(${selected.size} selected) ` : "";
						const choice = await ui.select(`${tag} ${prefix}${q.question}`, opts);
						if (choice === undefined) break;
						if (choice === `${status.success} Done selecting`) break;
						if (choice === "Other (type your own)") {
							customInput = await ui.editor("Enter your response:");
							break;
						}
						// Toggle the selected option
						const checkedPrefix = `${checkbox.checked} `;
						const uncheckedPrefix = `${checkbox.unchecked} `;
						let opt: string | undefined;
						if (choice.startsWith(checkedPrefix)) {
							opt = choice.slice(checkedPrefix.length);
						} else if (choice.startsWith(uncheckedPrefix)) {
							opt = choice.slice(uncheckedPrefix.length);
						}
						if (opt) {
							if (selected.has(opt)) {
								selected.delete(opt);
							} else {
								selected.add(opt);
							}
						}
					}
					// Map display labels back to originals to avoid stripping user labels
					const cleanSelected = Array.from(selected).map(s => {
						const idx = displayOptions.indexOf(s);
						return idx >= 0 ? originalOptions[idx] : s;
					});
					answers.push({ id: q.id, selectedOptions: cleanSelected, customInput });
				} else {
					// Single-select
					const selected = await ui.select(`${tag} ${q.question}`, displayOptions);
					if (selected === undefined) {
						answers.push({ id: q.id, selectedOptions: [] });
					} else {
						// Map display label back to original to avoid stripping user labels
						const idx = displayOptions.indexOf(selected);
						const clean = idx >= 0 ? originalOptions[idx] : selected;
						answers.push({ id: q.id, selectedOptions: [clean] });
					}
				}
			}
			return answers;
		}
		// If parent itself is a subtask with an askHandler, chain through with tag
		if (parentAskHandler) {
			const taggedQuestions = questions.map(q => ({ ...q, question: `${tag} ${q.question}` }));
			return parentAskHandler(taggedQuestions);
		}
		// Defensive: unreachable since handler is only created when ui or parentAskHandler is truthy
		throw new Error("No UI available for ask");
	};
}
