import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = resolve(root, "dist");

rmSync(dist, { recursive: true, force: true });

await buildEntry("src/background/service-worker.ts", "background/service-worker.js", "esm");
await buildEntry("src/content/content-script.ts", "content/content-script.js", "iife");
await buildEntry("src/popup/popup.ts", "popup/popup.js", "esm");
await buildEntry("src/options/options.ts", "options/options.js", "esm");

copy("manifest.template.json", "manifest.json");
copy("src/popup/popup.html", "popup/popup.html");
copy("src/popup/popup.css", "popup/popup.css");
copy("src/options/options.html", "options/options.html");
copy("src/options/options.css", "options/options.css");
copy("src/privacy/privacy-policy.html", "privacy/privacy-policy.html");

async function buildEntry(entry, outfile, format) {
  const output = resolve(dist, outfile);
  mkdirSync(dirname(output), { recursive: true });
  await build({
    entryPoints: [resolve(root, entry)],
    outfile: output,
    bundle: true,
    format,
    target: "es2022",
    sourcemap: false,
    minify: false,
    logLevel: "silent"
  });
}

function copy(from, to) {
  const output = resolve(dist, to);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(resolve(root, from), output);
}
