import { describe, expect, it } from "vitest";
import { shouldTranslateText } from "../../src/content/text-filter";

describe("text filter", () => {
  it("skips urls, numbers and machine-like identifiers", () => {
    expect(shouldTranslateText("https://example.com")).toBe(false);
    expect(shouldTranslateText("123456")).toBe(false);
    expect(shouldTranslateText("src/components/App.tsx")).toBe(false);
  });

  it("keeps prose and labels", () => {
    expect(shouldTranslateText("Get started with the API")).toBe(true);
    expect(shouldTranslateText("Submit")).toBe(true);
  });
});
