import { readFile, writeFile } from "node:fs/promises";
import { LAYOUT_CSS_VARIABLES } from "../src/layout-constants.mjs";
import { SEARCH_MATCHES } from "../src/search-hosts.mjs";

const manifestPath = new URL("../extension/manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.content_scripts[0].matches = SEARCH_MATCHES;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

// The manifest version is authoritative for both extension and npm metadata.
const packagePath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(await readFile(packagePath, "utf8"));
pkg.version = manifest.version;
await writeFile(packagePath, JSON.stringify(pkg, null, 2) + "\n");
const lockPath = new URL("../package-lock.json", import.meta.url);
const lock = JSON.parse(await readFile(lockPath, "utf8"));
lock.version = manifest.version;
lock.packages[""].version = manifest.version;
lock.packages[""].engines = pkg.engines;
await writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n");

const cssPath = new URL("../extension/content.css", import.meta.url);
const css = await readFile(cssPath, "utf8");
const block = / {2}\/\* BEGIN GENERATED LAYOUT[^\n]*\n[\s\S]*? {2}\/\* END GENERATED LAYOUT \*\//;
if (!block.test(css)) throw new Error("Missing generated layout markers in content.css");
const generated = "  /* BEGIN GENERATED LAYOUT: edit src/layout-constants.mjs */\n"
  + Object.entries(LAYOUT_CSS_VARIABLES).map(([name, value]) => `  ${name}: ${value};`).join("\n")
  + "\n  /* END GENERATED LAYOUT */";
await writeFile(cssPath, css.replace(block, generated));
