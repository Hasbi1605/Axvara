import { NextRequest } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type RpcRequest = {
  id?: unknown;
  method?: string;
  params?: {
    protocolVersion?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

type Tool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
};

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "MCP-Protocol-Version",
  "Cache-Control": "private, no-store",
  "MCP-Protocol-Version": "2025-06-18",
};

const tools: Tool[] = [
  {
    name: "get_store_context",
    description: "Read AXVARA products, categories, and the editorial guide.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_articles",
    description: "List article drafts and workflow states available to this token.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_article",
    description: "Read one article by numeric ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Numeric article ID" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "upload_article_image",
    description: "Upload a small WebP cover or inline image as base64. If the MCP client truncates long JSON strings, use import_article_image_from_url or POST the local file as multipart to /api/agent/media.",
    inputSchema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Raw base64 WebP bytes without a data-URL prefix; maximum 5 MB decoded" },
        filename: { type: "string", description: "Safe filename ending in .webp" },
        mime_type: { type: "string", enum: ["image/webp"] },
        kind: { type: "string", enum: ["cover", "content"] },
      },
      required: ["image_base64", "filename", "mime_type", "kind"],
      additionalProperties: false,
    },
  },
  {
    name: "import_article_image_from_url",
    description: "Import a WebP cover or inline image from a public HTTPS URL into AXVARA R2 without sending base64 through the MCP client.",
    inputSchema: {
      type: "object",
      properties: {
        source_url: { type: "string", format: "uri", maxLength: 2048, description: "Public HTTPS URL that returns a WebP file of at most 5 MB" },
        kind: { type: "string", enum: ["cover", "content"] },
      },
      required: ["source_url", "kind"],
      additionalProperties: false,
    },
  },
  {
    name: "create_article_draft",
    description: "Create an idempotent Markdown article draft. At least one research source is required.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 6, maxLength: 140 },
        content: { type: "string", minLength: 50, description: "Article body in Markdown" },
        cover_url: { type: ["string", "null"] },
        source_urls: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", format: "uri" } },
        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
        topic: { type: "string", maxLength: 200 },
      },
      required: ["title", "content", "source_urls", "idempotency_key"],
      additionalProperties: false,
    },
  },
  {
    name: "update_article_draft",
    description: "Update the title, Markdown body, cover, or sources of a draft.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string", minLength: 6, maxLength: 140 },
        content: { type: "string", minLength: 50 },
        cover_url: { type: ["string", "null"] },
        source_urls: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", format: "uri" } },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_article_for_review",
    description: "Move a draft to the admin review queue.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "schedule_article",
    description: "Schedule an article for a future ISO-8601 time. Requires articles:schedule.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, scheduled_at: { type: "string", format: "date-time" } },
      required: ["id", "scheduled_at"],
      additionalProperties: false,
    },
  },
  {
    name: "publish_article",
    description: "Publish an article immediately. Requires articles:publish.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "get_agent_activity",
    description: "Read recent editorial audit events. Requires audit:read.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function rpcResult(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: responseHeaders });
}

function rpcFailure(id: unknown, message: string, code: number) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: responseHeaders });
}

function withoutId(args: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(args).filter(([key]) => key !== "id"));
}

function decodeBase64(value: unknown) {
  if (typeof value !== "string" || value.length > 7_100_000) throw new Error("image_base64 tidak valid atau melebihi 5 MB");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.length > 5 * 1024 * 1024) throw new Error("Gambar melebihi 5 MB");
  return bytes;
}

async function callContentApi(
  name: string,
  args: Record<string, unknown>,
  bearer: string,
  origin: string,
) {
  if (name === "upload_article_image") {
    const bytes = decodeBase64(args.image_base64);
    const filename = String(args.filename ?? "article.webp");
    if (!/^[a-zA-Z0-9._-]+\.webp$/.test(filename) || args.mime_type !== "image/webp") {
      throw new Error("Media MCP harus berupa file WebP dengan nama yang aman");
    }
    const form = new FormData();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    form.append("file", new File([buffer], filename, { type: "image/webp" }));
    form.append("kind", String(args.kind ?? "content"));
    return fetch(`${origin}/api/agent/media`, {
      method: "POST",
      headers: { authorization: bearer },
      body: form,
    });
  }

  const definitions: Record<string, { path: string; method?: string; body?: Record<string, unknown> }> = {
    get_store_context: { path: "/api/agent/context" },
    list_articles: { path: "/api/agent/articles" },
    get_article: { path: `/api/agent/articles/${encodeURIComponent(String(args.id ?? ""))}` },
    import_article_image_from_url: { path: "/api/agent/media/import", method: "POST", body: args },
    create_article_draft: { path: "/api/agent/articles", method: "POST", body: args },
    update_article_draft: { path: `/api/agent/articles/${encodeURIComponent(String(args.id ?? ""))}`, method: "PUT", body: withoutId(args) },
    submit_article_for_review: { path: `/api/agent/articles/${encodeURIComponent(String(args.id ?? ""))}/submit`, method: "POST", body: {} },
    schedule_article: { path: `/api/agent/articles/${encodeURIComponent(String(args.id ?? ""))}/schedule`, method: "POST", body: withoutId(args) },
    publish_article: { path: `/api/agent/articles/${encodeURIComponent(String(args.id ?? ""))}/publish`, method: "POST", body: {} },
    get_agent_activity: { path: "/api/agent/activity" },
  };
  const target = definitions[name];
  if (!target) throw new Error("Tool not found");
  return fetch(`${origin}${target.path}`, {
    method: target.method ?? "GET",
    headers: {
      authorization: bearer,
      ...(target.method ? { "content-type": "application/json" } : {}),
    },
    body: target.method ? JSON.stringify(target.body ?? {}) : undefined,
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      ...responseHeaders,
      "Access-Control-Allow-Headers": "authorization,content-type,mcp-protocol-version",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

export async function GET() {
  return new Response("This stateless MCP server accepts Streamable HTTP POST requests.", {
    status: 405,
    headers: { ...responseHeaders, Allow: "POST" },
  });
}

export async function POST(request: NextRequest) {
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) {
    return new Response("Bearer token required", { status: 401, headers: responseHeaders });
  }
  const rpc = await request.json().catch(() => null) as RpcRequest | null;
  if (!rpc?.method) return rpcFailure(null, "Invalid JSON-RPC request", -32600);

  if (rpc.method === "initialize") {
    const requested = String(rpc.params?.protocolVersion ?? "");
    const protocolVersion = ["2025-06-18", "2025-03-26"].includes(requested) ? requested : "2025-06-18";
    return rpcResult(rpc.id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "axvara", version: "1.3.0" },
    });
  }
  if (rpc.method === "notifications/initialized") return new Response(null, { status: 202, headers: responseHeaders });
  if (rpc.method === "tools/list") return rpcResult(rpc.id, { tools });
  if (rpc.method !== "tools/call" || !rpc.params?.name) return rpcFailure(rpc.id, "Unknown method", -32601);

  try {
    const response = await callContentApi(
      rpc.params.name,
      rpc.params.arguments ?? {},
      bearer,
      new URL(request.url).origin,
    );
    const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    return rpcResult(rpc.id, {
      content: [{ type: "text", text: JSON.stringify(data) }],
      isError: !response.ok,
    });
  } catch (error) {
    return rpcResult(rpc.id, {
      content: [{ type: "text", text: error instanceof Error ? error.message : "MCP tool gagal" }],
      isError: true,
    });
  }
}
