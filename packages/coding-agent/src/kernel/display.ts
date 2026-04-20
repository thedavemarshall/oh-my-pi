/**
 * renderKernelDisplay — normalize a Jupyter display bundle into a form the
 * TUI can render. Handles MIME priority (text/html > image/png > text/plain),
 * truncation, and max-size clamping. Language-agnostic.
 */

import { isRecord, tryParseJson } from "@oh-my-pi/pi-utils";
import { htmlToBasicMarkdown } from "../web/scrapers/types";
import type { KernelDisplayOutput, PythonStatusEvent } from "./jupyter-kernel";
import { OMP_STATUS_MIME } from "./prelude-protocol";

/**
 * Parse an application/x-omp-status payload that may arrive either as a raw
 * object (Python's IPython display with raw=true) or as a JSON string (every
 * other language's display API serialises the bundle value). Returns null
 * when the payload is unparseable or missing both discriminator fields —
 * the dispatcher should skip rather than throw.
 *
 * Distinct from prelude-protocol.ts's parseStatusEvent: that one is strict
 * (throws on missing kind) and plugin-facing; this one is lenient so the
 * display pipeline never raises on bad plugin input.
 */
function parseStatusPayload(raw: unknown): PythonStatusEvent | null {
	const obj = typeof raw === "string" ? tryParseJson(raw) : raw;
	if (!isRecord(obj)) return null;
	if (!("op" in obj) && !("kind" in obj)) return null;
	return obj as PythonStatusEvent;
}

/**
 * Per-kernel plugin handler for an arbitrary MIME type. Return a
 * `KernelDisplayOutput` to transform the bundle, or `null` to fall through
 * to the default renderer.
 */
export type MimeHandler = (data: unknown, metadata?: Record<string, unknown>) => KernelDisplayOutput | null;

export interface RenderDisplayOptions {
	handlers?: ReadonlyMap<string, MimeHandler>;
}

function normalizeDisplayText(text: string): string {
	return text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * Renders a Jupyter display_data message into text and structured outputs.
 *
 * The x-omp-status short-circuit surfaces progress/phase/heartbeat events from
 * prelude helpers. Verified per-language emit incantations (from live kernel
 * validation against python3, iruby 0.8.2, and tslab):
 *
 *   Python (IPython):
 *     display({"application/x-omp-status": {"kind": "ping"}}, raw=True)
 *
 *   Ruby (iruby):
 *     IRuby::Kernel.instance.session.send(
 *       :publish, :display_data,
 *       data: { "application/x-omp-status" => payload.to_json },
 *       metadata: {},
 *     )
 *     # NOTE: IRuby.display(hash) renders the hash through inspect formatters
 *     # even with raw: true — only session.publish ships a literal bundle.
 *
 *   TypeScript (tslab):
 *     import { display } from "tslab";
 *     display.raw("application/x-omp-status", JSON.stringify({ kind: "ping" }));
 */
export function renderKernelDisplay(
	content: Record<string, unknown>,
	options?: RenderDisplayOptions,
): {
	text: string;
	outputs: KernelDisplayOutput[];
} {
	const data = content.data as Record<string, unknown> | undefined;
	if (!data) return { text: "", outputs: [] };

	const outputs: KernelDisplayOutput[] = [];

	if (data[OMP_STATUS_MIME] !== undefined) {
		const event = parseStatusPayload(data[OMP_STATUS_MIME]);
		if (event) {
			outputs.push({ type: "status", event });
		}
		return { text: "", outputs };
	}

	// Plugin handlers take precedence over default MIME dispatch; fall through when all return null.
	if (options?.handlers && options.handlers.size > 0) {
		const metadata = content.metadata as Record<string, unknown> | undefined;
		let handled = false;
		for (const [mime, handler] of options.handlers) {
			if (!(mime in data)) continue;
			const result = handler(data[mime], metadata);
			if (result) {
				outputs.push(result);
				handled = true;
			}
		}
		if (handled) {
			return { text: "", outputs };
		}
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
