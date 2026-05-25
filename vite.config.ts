import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

const root = resolve(__dirname);
const dist = resolve(root, "dist");

const entries = {
  "background/service-worker": resolve(root, "src/background/service-worker.ts"),
  "content/content-script": resolve(root, "src/content/content-script.ts"),
  "popup/popup": resolve(root, "src/popup/popup.ts"),
  "options/options": resolve(root, "src/options/options.ts")
};

function copyStaticFiles() {
  return {
    name: "copy-static-extension-files",
    buildStart() {
      rmSync(dist, { recursive: true, force: true });
    },
    closeBundle() {
      const copies = [
        ["manifest.template.json", "manifest.json"],
        ["src/popup/popup.html", "popup/popup.html"],
        ["src/popup/popup.css", "popup/popup.css"],
        ["src/options/options.html", "options/options.html"],
        ["src/options/options.css", "options/options.css"]
      ] as const;

      for (const [from, to] of copies) {
        const target = resolve(dist, to);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(resolve(root, from), target);
      }
    }
  };
}

export default defineConfig({
  plugins: [copyStaticFiles()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    minify: false,
    rollupOptions: {
      input: entries,
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "shared/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true
  }
});
