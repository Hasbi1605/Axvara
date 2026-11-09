import { readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/games-assets.mjs <srcDir>");
const output = "public/brand/games";
await mkdir(output, { recursive: true });
for (const slug of ["free-fire", "free-fire-max", "mobile-legends", "pubg-mobile"]) {
  const dir = path.join(source, slug);
  const files = await readdir(dir);
  for (const kind of ["icon", "banner"]) {
    const matches = files.filter((file) => new RegExp(`^${kind}\\.(png|jpe?g|webp)$`, "i").test(file));
    if (matches.length !== 1) throw new Error(`Expected one ${kind} image in ${dir}`);
    await sharp(path.join(dir, matches[0])).rotate().resize({ width: kind === "icon" ? 512 : 1600, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(output, `${slug}-${kind}.webp`));
  }
}
