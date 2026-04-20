/**
 * Jupyter wire protocol — message types and WebSocket frame serialization.
 *
 * Pure encode/decode for messages exchanged with jupyter-kernel-gateway over
 * WebSocket. Stateless; no kernel or session dependencies. The gateway wraps
 * the classic multi-part ZMQ kernel-wire protocol in a single binary frame:
 *
 *   [ offset_count (u32 LE) ]
 *   [ offset_0 ... offset_{n-1} (u32 LE each) ]
 *   [ json message ]
 *   [ binary buffer 1 ... binary buffer k ]
 *
 * offset_0 points at the JSON message; subsequent offsets point at each binary
 * buffer. Binary buffers are rare (used by some display MIME types) but
 * supported so nothing is lost.
 */

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export interface JupyterHeader {
	msg_id: string;
	session: string;
	username: string;
	date: string;
	msg_type: string;
	version: string;
}

export interface JupyterMessage {
	channel: string;
	header: JupyterHeader;
	parent_header: Record<string, unknown>;
	metadata: Record<string, unknown>;
	content: Record<string, unknown>;
	buffers?: Uint8Array[];
}

export function deserializeWebSocketMessage(data: ArrayBuffer): JupyterMessage | null {
	const view = new DataView(data);
	const offsetCount = view.getUint32(0, true);

	if (offsetCount < 1) return null;

	const offsets: number[] = [];
	for (let i = 0; i < offsetCount; i++) {
		offsets.push(view.getUint32(4 + i * 4, true));
	}

	const msgStart = offsets[0];
	const msgEnd = offsets.length > 1 ? offsets[1] : data.byteLength;
	const msgBytes = new Uint8Array(data, msgStart, msgEnd - msgStart);
	const msgText = TEXT_DECODER.decode(msgBytes);

	try {
		const msg = JSON.parse(msgText) as {
			channel: string;
			header: JupyterHeader;
			parent_header: Record<string, unknown>;
			metadata: Record<string, unknown>;
			content: Record<string, unknown>;
		};

		const buffers: Uint8Array[] = [];
		for (let i = 1; i < offsets.length; i++) {
			const start = offsets[i];
			const end = i + 1 < offsets.length ? offsets[i + 1] : data.byteLength;
			buffers.push(new Uint8Array(data, start, end - start));
		}

		return { ...msg, buffers };
	} catch {
		return null;
	}
}

export function serializeWebSocketMessage(msg: JupyterMessage): ArrayBuffer {
	const msgText = JSON.stringify({
		channel: msg.channel,
		header: msg.header,
		parent_header: msg.parent_header,
		metadata: msg.metadata,
		content: msg.content,
	});

	const buffers = msg.buffers ?? [];
	const offsetCount = 1 + buffers.length;
	const headerSize = 4 + offsetCount * 4;
	const msgBytes = Buffer.byteLength(msgText);
	let totalSize = headerSize + msgBytes;
	for (const buf of buffers) {
		totalSize += buf.length;
	}

	const result = new ArrayBuffer(totalSize);
	const view = new DataView(result);
	const bytes = new Uint8Array(result);

	view.setUint32(0, offsetCount, true);

	let offset = headerSize;
	view.setUint32(4, offset, true);
	TEXT_ENCODER.encodeInto(msgText, bytes.subarray(offset));
	offset += msgBytes;

	for (let i = 0; i < buffers.length; i++) {
		view.setUint32(4 + (i + 1) * 4, offset, true);
		bytes.set(buffers[i], offset);
		offset += buffers[i].length;
	}

	return result;
}
