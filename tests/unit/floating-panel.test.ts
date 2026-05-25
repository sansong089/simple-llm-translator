import { describe, expect, it } from "vitest";
import { showFloatingPanel } from "../../src/content/floating-panel";

describe("floating panel", () => {
  it("renders streaming partial text", () => {
    showFloatingPanel({
      type: "SHOW_FLOATING_PANEL",
      status: "streaming",
      sourceText: "Hello",
      partialText: "你好"
    });

    const panel = document.querySelector("#llm-web-translator-floating-panel");
    expect(panel?.textContent).toContain("翻译中...");
    expect(panel?.textContent).toContain("你好");
  });
});
