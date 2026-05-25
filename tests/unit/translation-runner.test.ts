import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationRunner } from "../../src/content/translation-runner";

describe("translation runner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = {
      runtime: {
        sendMessage: vi.fn()
      }
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("removes queued segment indicators when the run stops", () => {
    const host = document.createElement("p");
    host.textContent = "Hello world";
    Object.defineProperty(host, "getBoundingClientRect", {
      value: () => ({
        width: 120,
        height: 20,
        top: 0,
        left: 0,
        right: 120,
        bottom: 20,
        x: 0,
        y: 0,
        toJSON: () => ({})
      })
    });
    document.body.append(host);

    const runner = new TranslationRunner();
    runner.start("run-1", 0, {
      targetLanguage: "中文",
      maxCharsPerBatch: 12000
    });

    expect(host.querySelector(".llm-web-translator-segment-indicator")).not.toBeNull();

    runner.stop();

    expect(host.querySelector(".llm-web-translator-segment-indicator")).toBeNull();
  });
});
