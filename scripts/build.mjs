import { cp, mkdir, rm } from "node:fs/promises";
import esbuild from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await esbuild.build({
  entryPoints: ["src/content.mjs", "src/popup.mjs"],
  bundle: true,
  outdir: "extension",
  entryNames: "[name]",
  format: "iife",
  platform: "browser",
  target: "chrome120",
});

await cp("extension/manifest.json", "dist/manifest.json");
await cp("extension/content.css", "dist/content.css");
await cp("extension/content.js", "dist/content.js");
await cp("extension/popup.html", "dist/popup.html");
await cp("extension/popup.css", "dist/popup.css");
await cp("extension/popup.js", "dist/popup.js");
await cp("extension/icons", "dist/icons", { recursive: true });

console.log("已构建，可加载 extension 或 dist 目录");
