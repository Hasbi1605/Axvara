export class RequestBodyError extends Error {
  constructor(public readonly status: 400 | 413, public readonly code: "invalid_body" | "payload_too_large") {
    super(code);
  }
}

/** Count actual stream bytes; Content-Length is only an early rejection hint. */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyError(413, "payload_too_large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        // A tee's cancellation can wait for its other branch; do not await it.
        void reader.cancel().catch(() => {});
        throw new RequestBodyError(413, "payload_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400, "invalid_body");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
