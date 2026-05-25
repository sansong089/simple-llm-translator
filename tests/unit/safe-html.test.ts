import { describe, expect, it } from "vitest";
import { isSafeHtmlContainer, validateAndBuildSafeFragment } from "../../src/content/safe-html";

describe("safe html", () => {
  it("allows simple inline html containers", () => {
    const element = document.createElement("p");
    element.innerHTML = "Hello <strong>world</strong>";
    expect(isSafeHtmlContainer(element)).toBe(true);
  });

  it("rejects changed tag structure", () => {
    const result = validateAndBuildSafeFragment("Hello <strong>world</strong>", "你好 <em>世界</em>");
    expect(result).toBeNull();
  });

  it("rejects dangerous attributes", () => {
    const result = validateAndBuildSafeFragment('<span title="x">Hello</span>', '<span title="x" onclick="x()">你好</span>');
    expect(result).toBeNull();
  });

  it("builds safe fragment for preserved tags", () => {
    const result = validateAndBuildSafeFragment("Hello <strong>world</strong>", "你好 <strong>世界</strong>");
    expect(result).not.toBeNull();
    const host = document.createElement("p");
    host.append(result!);
    expect(host.innerHTML).toBe("你好 <strong>世界</strong>");
  });

  it("builds safe fragment for preserved inline links", () => {
    const result = validateAndBuildSafeFragment(
      'The Lua API documentation is provided here <a href=\"/lua\" target=\"_blank\" rel=\"noopener\">Lua API Reference</a>',
      'Lua API 文档在此提供 <a href=\"/lua\" target=\"_blank\" rel=\"noopener\">Lua API 参考</a>'
    );
    expect(result).not.toBeNull();
    const host = document.createElement("p");
    host.append(result!);
    expect(host.innerHTML).toBe('Lua API 文档在此提供 <a href=\"/lua\" target=\"_blank\" rel=\"noopener\">Lua API 参考</a>');
  });
});
