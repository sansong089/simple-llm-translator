import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanVisibleSegments } from "../../src/content/dom-scanner";

describe("dom scanner", () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          width: 100,
          height: 20,
          top: 0,
          bottom: 20,
          left: 0,
          right: 100,
          x: 0,
          y: 0,
          toJSON() {
            return {};
          }
        }) as DOMRect
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("sends simple wrapped text as plain text without html tags", () => {
    document.body.innerHTML =
      '<a><span title="effective_aniii" class="linkLabel_WmDU">effective_aniii</span></a>';

    const segments = scanVisibleSegments(document.body, {});

    expect(segments).toHaveLength(1);
    expect(segments[0]?.segment.kind).toBe("text");
    expect(segments[0]?.segment.text).toBe("effective_aniii");
  });

  it("keeps nested style wrappers on the plain-text path", () => {
    document.body.innerHTML = "<p><strong><span>Hello world</span></strong></p>";

    const segments = scanVisibleSegments(document.body, {});

    expect(segments).toHaveLength(1);
    expect(segments[0]?.segment.kind).toBe("text");
    expect(segments[0]?.segment.text).toBe("Hello world");
  });

  it("falls back to safe-html when text spans multiple inline text nodes", () => {
    document.body.innerHTML = "<p>Hello <strong>world</strong></p>";

    const segments = scanVisibleSegments(document.body, {});

    expect(segments).toHaveLength(1);
    expect(segments[0]?.segment.kind).toBe("safe-html");
    expect(segments[0]?.segment.text).toBe("Hello <strong>world</strong>");
  });

  it("treats inline links inside a paragraph as safe-html so the sentence stays intact", () => {
    document.body.innerHTML = '<p>The Lua API documentation is provided here <a href=\"/lua\">Lua API Reference</a></p>';

    const segments = scanVisibleSegments(document.body, {});

    expect(segments).toHaveLength(1);
    expect(segments[0]?.segment.kind).toBe("safe-html");
    expect(segments[0]?.segment.text).toBe('The Lua API documentation is provided here <a href=\"/lua\">Lua API Reference</a>');
  });

  it("includes visible elements outside the current viewport by default", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const top = this.id === "far" ? 5000 : 0;
        return {
          width: 100,
          height: 20,
          top,
          bottom: top + 20,
          left: 0,
          right: 100,
          x: 0,
          y: top,
          toJSON() {
            return {};
          }
        } as DOMRect;
      }
    );

    document.body.innerHTML = '<p id="near">Hello</p><p id="far">World</p>';

    const segments = scanVisibleSegments(document.body);

    expect(segments.map((segment) => segment.segment.text)).toEqual(["Hello", "World"]);
  });
});
