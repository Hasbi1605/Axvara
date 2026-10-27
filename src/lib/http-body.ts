import { NextResponse } from "next/server";
import { readBoundedText, RequestBodyError } from "./bounded-body";

export async function readTextBody(request: Request, maxBytes: number) {
  try {
    return { ok: true as const, data: await readBoundedText(request, maxBytes) };
  } catch (error) {
    const failure = error instanceof RequestBodyError ? error : new RequestBodyError(400, "invalid_body");
    return { ok: false as const, response: NextResponse.json({ error: failure.code }, { status: failure.status }) };
  }
}

export async function readJsonBody(request: Request, maxBytes = 32_000) {
  const result = await readTextBody(request, maxBytes);
  if (!result.ok) return result;
  try {
    return { ok: true as const, data: JSON.parse(result.data) as unknown };
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: "Body tidak valid." }, { status: 400 }) };
  }
}
