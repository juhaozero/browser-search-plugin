import { cp, mkdir, rm } from "node:fs/promises";
import esbuild from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await esbuild.build({
  entryPoints: ["src/content-baidu.mjs"],
  bundle: true,
  outfile: "dist/content.js",
  format: "iife",
  platform: "browser",
  target: "chrome120",
});

await cp("extension/manifest.json", "dist/manifest.json");
await cp("extension/content.css", "dist/content.css");
