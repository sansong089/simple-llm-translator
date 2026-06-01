import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(__dirname, "../..");

describe("extension branding", () => {
  test("uses the configured plugin name in public extension surfaces", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "manifest.template.json"), "utf8")) as {
      name: string;
      action: { default_title: string };
      host_permissions?: string[];
      content_scripts?: unknown[];
    };
    const popupHtml = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");
    const optionsHtml = readFileSync(resolve(root, "src/options/options.html"), "utf8");

    expect(manifest.name).toBe("Simple LLM Translator");
    expect(manifest.action.default_title).toBe("Simple LLM Translator");
    expect(manifest.host_permissions).toEqual(["<all_urls>"]);
    expect(manifest.content_scripts).toBeUndefined();
    expect(popupHtml).toContain("<title>Simple LLM Translator</title>");
    expect(optionsHtml).toContain("<title>Simple LLM Translator 设置</title>");
    expect(optionsHtml).toContain("../privacy/privacy-policy.html");
  });
});
