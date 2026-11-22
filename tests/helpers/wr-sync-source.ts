import { readFileSync, readdirSync } from "node:fs";

export function readWrSyncSource(): string {
  const path = "src/lib/warung-rebahan/sync";
  const leaves = readdirSync(path, { withFileTypes: true })
    .filter(file => file.isFile() && file.name.endsWith(".ts"))
    .map(file => `${path}/${file.name}`).sort();
  if (!leaves.length) throw new Error(`No ${path}/*.ts sources found`);
  return [`${path}.ts`, ...leaves].map(file => readFileSync(file, "utf8")).join("\n");
}
