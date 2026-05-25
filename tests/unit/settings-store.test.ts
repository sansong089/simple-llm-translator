import { describe, expect, it } from "vitest";
import { getSelectedModelConfig, validateSettings } from "../../src/background/settings-store";
import type { Settings } from "../../src/shared/types";

function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    modelConfigs: [
      {
        id: "primary",
        name: "主接口",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        model: "gpt-test",
        jsonOutputMode: false
      }
    ],
    selectedModelConfigId: "primary",
    targetLanguage: "中文",
    requestTimeoutMs: 30000,
    maxCharsPerBatch: 12000,
    ...overrides
  };
}

describe("settings validation", () => {
  it("accepts a selected OpenAI-compatible model config", () => {
    const errors = validateSettings(createSettings());
    expect(errors).toEqual([]);
  });

  it("requires the selected model config to be complete", () => {
    const errors = validateSettings(
      createSettings({
        modelConfigs: [
          {
            id: "primary",
            name: "主接口",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "",
            model: "gpt-test",
            jsonOutputMode: false
          }
        ]
      })
    );
    expect(errors.some((error) => error.includes("API Key"))).toBe(true);
  });

  it("returns the selected model config", () => {
    const selected = getSelectedModelConfig(
      createSettings({
        modelConfigs: [
          {
            id: "primary",
            name: "主接口",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-primary",
            model: "gpt-primary",
            jsonOutputMode: false
          },
          {
            id: "backup",
            name: "备用接口",
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-backup",
            model: "gpt-backup",
            jsonOutputMode: true
          }
        ],
        selectedModelConfigId: "backup"
      })
    );

    expect(selected?.id).toBe("backup");
    expect(selected?.jsonOutputMode).toBe(true);
  });
});
