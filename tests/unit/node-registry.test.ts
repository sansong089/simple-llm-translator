import { describe, expect, it } from "vitest";
import { NodeRegistry, type SegmentState } from "../../src/content/node-registry";

describe("node registry", () => {
  it("writes grouped plain-text results back into the original wrapped text node", () => {
    const host = document.createElement("a");
    host.innerHTML = '<span title="effective_aniii" class="linkLabel_WmDU">effective_aniii</span>';
    document.body.append(host);
    const textNode = host.querySelector("span")!.firstChild as Text;

    const state: SegmentState = {
      segmentId: "text-1",
      runId: "run-1",
      segment: {
        id: "text-1",
        kind: "text",
        text: "effective_aniii",
        context: "text"
      },
      nodes: [textNode],
      originalTexts: [textNode.textContent ?? ""],
      status: "pending"
    };

    const registry = new NodeRegistry();
    expect(registry.add(state)).toBe(true);

    registry.applyItems("run-1", [{ id: "text-1", text: "effective aniii" }]);

    expect(host.innerHTML).toBe('<span title="effective_aniii" class="linkLabel_WmDU">effective aniii</span>');
    expect(state.status).toBe("translated");
    expect(host.querySelector(".llm-web-translator-segment-indicator")).toBeNull();
  });

  it("writes nested wrapped plain text without replacing the html structure", () => {
    const host = document.createElement("p");
    host.innerHTML = "<strong><span>Hello world</span></strong>";
    document.body.append(host);
    const textNode = host.querySelector("span")!.firstChild as Text;

    const state: SegmentState = {
      segmentId: "text-2",
      runId: "run-1",
      segment: {
        id: "text-2",
        kind: "text",
        text: "Hello world",
        context: "text"
      },
      nodes: [textNode],
      originalTexts: [textNode.textContent ?? ""],
      status: "pending"
    };

    const registry = new NodeRegistry();
    expect(registry.add(state)).toBe(true);
    expect(host.querySelector(".llm-web-translator-segment-indicator")).not.toBeNull();

    registry.applyItems("run-1", [{ id: "text-2", text: "你好，世界" }]);

    expect(host.innerHTML).toBe("<strong><span>你好，世界</span></strong>");
    expect(state.status).toBe("translated");
    expect(host.querySelector(".llm-web-translator-segment-indicator")).toBeNull();
  });

  it("updates plain text incrementally before finalizing", () => {
    const host = document.createElement("p");
    host.textContent = "Hello world";
    document.body.append(host);
    const textNode = host.firstChild as Text;

    const state: SegmentState = {
      segmentId: "text-3",
      runId: "run-1",
      segment: {
        id: "text-3",
        kind: "text",
        text: "Hello world",
        context: "text"
      },
      nodes: [textNode],
      originalTexts: [textNode.textContent ?? ""],
      status: "pending"
    };

    const registry = new NodeRegistry();
    expect(registry.add(state)).toBe(true);
    expect(host.querySelector(".llm-web-translator-segment-indicator")).not.toBeNull();

    registry.applyPartialText("run-1", "text-3", "你好");
    expect(host.textContent).toBe("你好");
    expect(state.status).toBe("translating");
    expect(host.querySelector(".llm-web-translator-segment-indicator")).not.toBeNull();

    registry.applyFinalItem("run-1", { id: "text-3", text: "你好，世界" });
    expect(host.textContent).toBe("你好，世界");
    expect(state.status).toBe("translated");
    expect(host.querySelector(".llm-web-translator-segment-indicator")).toBeNull();
  });

  it("fails final write only when dom changes outside the streaming path", () => {
    const host = document.createElement("p");
    host.textContent = "Hello world";
    document.body.append(host);
    const textNode = host.firstChild as Text;

    const state: SegmentState = {
      segmentId: "text-4",
      runId: "run-1",
      segment: {
        id: "text-4",
        kind: "text",
        text: "Hello world",
        context: "text"
      },
      nodes: [textNode],
      originalTexts: [textNode.textContent ?? ""],
      expectedTexts: [textNode.textContent ?? ""],
      status: "pending"
    };

    const registry = new NodeRegistry();
    expect(registry.add(state)).toBe(true);

    registry.applyPartialText("run-1", "text-4", "你好");
    host.textContent = "外部修改";

    registry.applyFinalItem("run-1", { id: "text-4", text: "你好，世界" });
    expect(state.status).toBe("failed");
    expect(state.errorMessage).toBe("NODE_CHANGED");
    expect(host.querySelector(".llm-web-translator-segment-indicator")).toBeNull();
  });

  it("only writes safe html on final item", () => {
    const host = document.createElement("p");
    host.innerHTML = "Hello <strong>world</strong>";
    document.body.append(host);
    const textNodes = Array.from(host.childNodes).filter((node): node is Text => node.nodeType === Node.TEXT_NODE || node.nodeName === "#text");
    const strongText = host.querySelector("strong")!.firstChild as Text;

    const state: SegmentState = {
      segmentId: "html-1",
      runId: "run-1",
      segment: {
        id: "html-1",
        kind: "safe-html",
        text: "Hello <strong>world</strong>",
        context: "text"
      },
      nodes: [textNodes[0]!, strongText],
      container: host,
      originalTexts: [textNodes[0]!.textContent ?? "", strongText.textContent ?? ""],
      originalHtml: host.innerHTML,
      status: "pending"
    };

    const registry = new NodeRegistry();
    expect(registry.add(state)).toBe(true);
    expect(host.parentElement?.querySelector(".llm-web-translator-segment-indicator")).not.toBeNull();
    expect(host.querySelector(".llm-web-translator-segment-indicator")).toBeNull();

    registry.applyPartialText("run-1", "html-1", "ignored");
    expect(host.innerHTML).toBe("Hello <strong>world</strong>");

    registry.applyFinalItem("run-1", { id: "html-1", text: "你好，<strong>世界</strong>" });
    expect(host.innerHTML).toBe("你好，<strong>世界</strong>");
    expect(state.status).toBe("translated");
    expect(host.parentElement?.querySelector(".llm-web-translator-segment-indicator")).toBeNull();
  });

  it("clears remaining indicators when the registry resets", () => {
    const host = document.createElement("p");
    host.textContent = "Hello world";
    document.body.append(host);
    const textNode = host.firstChild as Text;

    const state: SegmentState = {
      segmentId: "text-5",
      runId: "run-1",
      segment: {
        id: "text-5",
        kind: "text",
        text: "Hello world",
        context: "text"
      },
      nodes: [textNode],
      originalTexts: [textNode.textContent ?? ""],
      status: "pending"
    };

    const registry = new NodeRegistry();
    expect(registry.add(state)).toBe(true);
    expect(host.querySelector(".llm-web-translator-segment-indicator")).not.toBeNull();

    registry.clear();
    expect(host.querySelector(".llm-web-translator-segment-indicator")).toBeNull();
  });
});
