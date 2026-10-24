import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { deployGateway } = createRequire(import.meta.url)("../scripts/ci-whatsapp-gateway.cjs") as {
  deployGateway: (env: Record<string,string>, fetchFn: typeof fetch) => Promise<void>;
};
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding:"utf8" }).trim();
const env = { HEROKU_API_KEY:"fixture-private-key", GITHUB_SHA:revision };

function transport(options: { baseline?: boolean; rollback?: boolean; failed?: boolean; uploadFailed?: boolean } = {}) {
  let archive: Uint8Array | undefined;
  const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url).split("/").at(-1);
    if (path === "builds" && !init?.body) return Response.json(options.baseline ? [{status:"succeeded", created_at:"2026-10-24", slug:{id:"current"},source_blob:{version:revision}}] : []);
    if (path === "releases") return Response.json(options.baseline ? [{status:"succeeded",version:2,slug:{id:options.rollback ? "rolled-back" : "current"}}] : []);
    if (path === "sources") return Response.json({source_blob:{put_url:"https://upload.test/source",get_url:"https://download.test/source"}});
    if (String(url) === "https://upload.test/source") {
      archive = init?.body as Uint8Array;
      expect((init?.headers as Record<string,string>).Authorization).toBeUndefined();
      return new Response(null, {status:options.uploadFailed ? 403 : 200});
    }
    if (path === "builds") return Response.json({id:"new-build"});
    if (path === "new-build") return Response.json({status:options.failed ? "failed" : "succeeded"});
    throw new Error("Unexpected test request");
  });
  return { fetchFn, archive: () => archive };
}
describe("gateway release through existing CI", () => {
  it("uploads only runtime source, without sessions, tests, dependencies or credentials", async () => {
    const t=transport(); await deployGateway(env,t.fetchFn);
    const directory=mkdtempSync(join(tmpdir(),"axvara-gateway-archive-test-"));
    try {
      const path=join(directory,"source.tgz");writeFileSync(path,t.archive()!);
      const entries=execFileSync("tar",["-tzf",path],{encoding:"utf8"});
      expect(entries).toContain("src/durable.ts");expect(entries).toContain("package-lock.json");
      expect(entries).not.toMatch(/node_modules|local-session|credentials|tests\/|\.env/);
    } finally {rmSync(directory,{recursive:true,force:true});}
    const request=t.fetchFn.mock.calls.find(([url,init])=>String(url).endsWith("/builds") && init?.body);
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({source_blob:{url:"https://download.test/source",version:revision}});
    expect(t.fetchFn.mock.calls.find(([url])=>String(url).endsWith("/sources"))?.[0]).toBe("https://api.heroku.com/sources");
    expect((t.fetchFn.mock.calls[0][1]?.headers as Record<string,string>).Range).toBe("created_at ..; order=desc,max=200");
  });
  it("skips only when a successful build still matches the active release",async()=>{
    const unchanged=transport({baseline:true});await deployGateway(env,unchanged.fetchFn);
    expect(unchanged.fetchFn).toHaveBeenCalledTimes(2);
    const rolledBack=transport({baseline:true,rollback:true});await deployGateway(env,rolledBack.fetchFn);
    expect(rolledBack.archive()).toBeDefined();
  });
  it("fails closed on missing secrets, upload failures and failed builds",async()=>{
    const missing=transport();await expect(deployGateway({},missing.fetchFn)).rejects.toThrow("secret");expect(missing.fetchFn).not.toHaveBeenCalled();
    const upload=transport({uploadFailed:true});await expect(deployGateway(env,upload.fetchFn)).rejects.toThrow("upload failed");
    expect(upload.fetchFn.mock.calls.filter(([url,init])=>String(url).endsWith("/builds") && init?.body)).toHaveLength(0);
    const failed=transport({failed:true});await expect(deployGateway(env,failed.fetchFn)).rejects.toThrow("build failed");
  });
});
