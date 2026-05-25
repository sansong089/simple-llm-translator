import { afterEach, describe, expect, it, vi } from "vitest";
import { streamTranslateSegments, translateSegments } from "../../src/background/openai-client";
import type { Settings, StreamingTranslationItem } from "../../src/shared/types";

const settings: Settings = {
  modelConfigs: [
    {
      id: "primary",
      name: "主接口",
      baseUrl: "https://api.example.com",
      apiKey: "sk-test",
      model: "test-model",
      jsonOutputMode: false
    }
  ],
  selectedModelConfigId: "primary",
  targetLanguage: "中文",
  requestTimeoutMs: 1_000,
  maxCharsPerBatch: 4_000
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openai client", () => {
  it("streams assistant deltas from chat completions SSE", async () => {
    const updates: StreamingTranslationItem[] = [];
    mockEventStream([
      'data: {"choices":[{"delta":{"content":"[[ITEM:selection]]long transl"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"ation[[/ITEM]]"}}]}\n\n',
      "data: [DONE]\n\n"
    ]);

    const result = await streamTranslateSegments(
      settings,
      "中文",
      [{ id: "selection", kind: "text", text: "Hello" }],
      {
        onUpdate: (item) => {
          updates.push(item);
        }
      }
    );

    expect(result).toEqual({ ok: true, items: [{ id: "selection", text: "long translation" }] });
    expect(updates.at(-1)).toEqual({ id: "selection", text: "long translation", done: true });
  });

  it("falls back to non-stream json when provider does not return event stream", async () => {
    mockJsonChatCompletion('{"items":[{"id":"selection","text":"你好"}]}');

    const updates: StreamingTranslationItem[] = [];
    const result = await streamTranslateSegments(
      settings,
      "中文",
      [{ id: "selection", kind: "text", text: "Hello" }],
      {
        onUpdate: (item) => {
          updates.push(item);
        }
      }
    );

    expect(result).toEqual({ ok: true, items: [{ id: "selection", text: "你好" }] });
    expect(updates).toEqual([{ id: "selection", text: "你好", done: true }]);
  });

  it("keeps completed items when the stream ends without done marker", async () => {
    mockEventStream(['data: {"choices":[{"delta":{"content":"[[ITEM:selection]]你好[[/ITEM]]"}}]}\n\n']);

    const result = await streamTranslateSegments(settings, "中文", [{ id: "selection", kind: "text", text: "Hello" }]);

    expect(result).toEqual({ ok: true, items: [{ id: "selection", text: "你好" }] });
  });

  it("reports an incomplete streamed item as a failed batch instead of a successful empty result", async () => {
    mockEventStream(['data: {"choices":[{"delta":{"content":"[[ITEM:selection]]部分译文"}}]}\n\n']);

    const updates: StreamingTranslationItem[] = [];
    const result = await streamTranslateSegments(
      settings,
      "中文",
      [{ id: "selection", kind: "text", text: "Hello" }],
      {
        onUpdate: (item) => {
          updates.push(item);
        }
      }
    );

    expect(result.ok).toBe(false);
    expect(updates).toEqual([]);
    if (!result.ok) {
      expect(result.error?.code).toBe("API_BAD_RESPONSE");
    }
  });

  it("accepts plain text only when single-text fallback is enabled", async () => {
    mockJsonChatCompletion("你好");

    const result = await translateSegments(
      settings,
      "中文",
      [{ id: "selection", kind: "text", text: "Hello" }],
      { allowPlainTextFallback: true }
    );

    expect(result).toEqual({ ok: true, items: [{ id: "selection", text: "你好" }] });
  });

  it("keeps batch translation protocol strict and reports returned content preview", async () => {
    mockJsonChatCompletion("你好");

    const result = await translateSegments(settings, "中文", [{ id: "n1", kind: "text", text: "Hello" }]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("API_BAD_RESPONSE");
      expect(result.error.message).toContain("实际返回「你好」");
    }
  });
});

function mockJsonChatCompletion(content: string): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  );
}

function mockEventStream(chunks: string[]): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        }
      }),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" }
      }
    )
  );
}
