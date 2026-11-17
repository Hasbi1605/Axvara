/** Healthy sold-out store; probes still exercise the structured quote conflict. */
export function syntheticResponse(url: string): Response | null {
  switch (new URL(url).pathname) {
    case "/": return new Response("<!doctype html><title>AXVARA</title>", { headers: { "content-type": "text/html" } });
    case "/api/products": return Response.json({ products: [{ id: 8, slug: "fixture", stock: 0 }] });
    case "/api/checkout/quote": return Response.json({ ok: false, issues: [{ type: "out_of_stock", message: "Habis" }] }, { status: 409 });
    default: return null;
  }
}
