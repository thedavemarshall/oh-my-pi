/**
 * renderKernelDisplay — normalize a Jupyter display bundle into a form the
 * TUI can render. Handles MIME priority (text/html > image/png > text/plain),
 * truncation, and max-size clamping.
 *
 * Language-agnostic. Consumed by tools/python.ts today; exported as SDK in PR 2
 * for plugin authors to reuse.
 */

import { htmlToBasicMarkdown } from "../web/scrapers/types";
import type { KernelDisplayOutput, PythonStatusEvent } from "./jupyter-kernel";

function normalizeDisplayText(text: string): string {
	return text.endsWith("\n") ? text : `${text}\n`;
}

/** Renders a Jupyter display_data message into text and structured outputs. */
export function renderKernelDisplay(content: Record<string, unknown>): {
	text: string;
	outputs: KernelDisplayOutput[];
} {
	const data = content.data as Record<string, unknown> | undefined;
	if (!data) return { text: "", outputs: [] };

	const outputs: KernelDisplayOutput[] = [];

	// Handle status events (custom MIME type from prelude helpers)
	if (data["application/x-omp-status"] !== undefined) {
		const statusData = data["application/x-omp-status"];
		if (statusData && typeof statusData === "object" && "op" in statusData) {
			outputs.push({ type: "status", event: statusData as PythonStatusEvent });
		}
		// Status events don't produce text output
		return { text: "", outputs };
	}

	if (typeof data["image/png"] === "string") {
		outputs.push({ type: "image", data: data["image/png"] as string, mimeType: "image/png" });
	}
	if (data["application/json"] !== undefined) {
		outputs.push({ type: "json", data: data["application/json"] });
	}

	// Check text/markdown before text/plain since Markdown objects provide both
	// (text/plain is just the repr)
	if (typeof data["text/markdown"] === "string") {
		outputs.push({ type: "markdown" });
		return { text: normalizeDisplayText(String(data["text/markdown"])), outputs };
	}
	if (typeof data["text/plain"] === "string") {
		return { text: normalizeDisplayText(String(data["text/plain"])), outputs };
	}
	if (data["text/html"] !== undefined) {
		const markdown = htmlToBasicMarkdown(String(data["text/html"])) || "";
		return { text: markdown ? normalizeDisplayText(markdown) : "", outputs };
	}
	return { text: "", outputs };
}
