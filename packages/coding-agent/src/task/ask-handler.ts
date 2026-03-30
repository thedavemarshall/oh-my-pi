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
				const options = [...q.options];
				if (q.multi) {
					// Multi-select: checkbox-toggle loop
					const { checkbox, status } = ui.theme;
					if (q.recommended !== undefined && q.recommended < options.length) {
						options[q.recommended] = `${options[q.recommended]} (Recommended)`;
					}
					const selected = new Set<string>();
					let customInput: string | undefined;
					while (true) {
						const opts: string[] = options.map(
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
					const cleanSelected = Array.from(selected).map(s => s.replace(/ \(Recommended\)$/, ""));
					answers.push({ id: q.id, selectedOptions: cleanSelected, customInput });
				} else {
					// Single-select
					if (q.recommended !== undefined && q.recommended < options.length) {
						options[q.recommended] = `${options[q.recommended]} (Recommended)`;
					}
					const selected = await ui.select(`${tag} ${q.question}`, options);
					if (selected === undefined) {
						answers.push({ id: q.id, selectedOptions: [] });
					} else {
						// Strip " (Recommended)" suffix if present
						const clean = selected.replace(/ \(Recommended\)$/, "");
						answers.push({ id: q.id, selectedOptions: [clean] });
					}
				}
			}
			return answers;
		}
		// If parent itself is a subtask with an askHandler, chain through
		if (parentAskHandler) {
			return parentAskHandler(questions);
		}
		// Defensive: unreachable since handler is only created when ui or parentAskHandler is truthy
		throw new Error("No UI available for ask");
	};
}
