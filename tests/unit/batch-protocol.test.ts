import { describe, expect, it } from "vitest";
import {
  buildStreamingProtocolPrompt,
  buildUserPayload,
  createStreamingTranslationParser,
  parseTranslationResponse
} from "../../src/shared/batch-protocol";

describe("batch protocol", () => {
  it("builds object payload with segment kind", () => {
    const payload = JSON.parse(buildUserPayload("中文", [{ id: "n1", kind: "safe-html", text: "Hello <strong>world</strong>" }]));
    expect(payload.targetLanguage).toBe("中文");
    expect(payload.segments[0].kind).toBe("safe-html");
  });

  it("parses top-level items object", () => {
    const result = parseTranslationResponse('{"items":[{"id":"n1","text":"你好"}]}');
    expect(result.items).toEqual([{ id: "n1", text: "你好" }]);
  });

  it("extracts json from markdown fence", () => {
    const result = parseTranslationResponse('```json\n{"items":[{"id":"n1","text":"你好"}]}\n```');
    expect(result.items[0]?.text).toBe("你好");
  });

  it("builds streaming protocol instructions with item markers", () => {
    expect(buildStreamingProtocolPrompt()).toContain("[[ITEM:<id>]]");
  });

  it("parses streaming markers across chunk boundaries", () => {
    const parser = createStreamingTranslationParser(["n1"]);
    expect(parser.push("[[IT")).toEqual([]);

    const updates = parser.push("EM:n1]]long transl");
    expect(updates).toEqual([{ id: "n1", text: "lon", done: false }]);

    const finalUpdates = parser.push("ation[[/ITEM]]");
    expect(finalUpdates).toEqual([{ id: "n1", text: "long translation", done: true }]);
    expect(parser.finish()).toEqual({ items: [{ id: "n1", text: "long translation" }], missingIds: [] });
  });

  it("ignores unknown ids and reports missing expected ids", () => {
    const parser = createStreamingTranslationParser(["n1", "n2"]);
    parser.push("[[ITEM:unknown]]skip[[/ITEM]][[ITEM:n1]]ok[[/ITEM]]");
    expect(parser.finish()).toEqual({ items: [{ id: "n1", text: "ok" }], missingIds: ["n2"] });
  });

  it("throws when a streaming item is not closed", () => {
    const parser = createStreamingTranslationParser(["n1"]);
    parser.push("[[ITEM:n1]]hello");
    expect(() => parser.finish()).toThrow("not closed");
  });

  it("rejects top-level array", () => {
    expect(() => parseTranslationResponse('[{"id":"n1","text":"你好"}]')).toThrow();
  });
});
