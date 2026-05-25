import { afterEach, describe, expect, it } from "vitest";
import { clearTab, ensureFrameRunning, getAggregatedStatus, isFrameRunActive, setFrameRunning, setFrameStopped } from "../../src/background/tab-state";

describe("tab state", () => {
  afterEach(() => {
    clearTab(1);
    clearTab(2);
  });

  it("marks a frame run active when started directly", () => {
    setFrameRunning(1, 0, "run-1");

    expect(isFrameRunActive(1, 0, "run-1")).toBe(true);
    expect(isFrameRunActive(1, 0, "run-2")).toBe(false);
  });

  it("restores frame routing when a batch arrives after background state loss", () => {
    ensureFrameRunning(1, 0, "run-2");

    expect(isFrameRunActive(1, 0, "run-2")).toBe(true);
  });

  it("tracks stopped state in aggregated tab status", () => {
    setFrameStopped(2, 0, "run-3");

    const status = getAggregatedStatus(true, true, [
      { frameId: 0, runId: "run-3", status: "stopped", pendingCount: 0, translatingCount: 0 }
    ]);

    expect(status.status).toBe("stopped");
  });
});
