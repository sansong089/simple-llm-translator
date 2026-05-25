import type { RunnerStatus, TabStatus } from "../shared/types";

interface FrameState {
  runId?: string;
  status: RunnerStatus["status"];
}

const state = new Map<number, Map<number, FrameState>>();

export function setFrameRunning(tabId: number, frameId: number, runId: string): void {
  getTabMap(tabId).set(frameId, { runId, status: "running" });
}

export function ensureFrameRunning(tabId: number, frameId: number, runId: string): void {
  const frameState = state.get(tabId)?.get(frameId);
  if (frameState?.status === "running" && frameState.runId === runId) return;
  setFrameRunning(tabId, frameId, runId);
}

export function setFrameStopped(tabId: number, frameId: number, runId?: string): void {
  getTabMap(tabId).set(frameId, { runId, status: "stopped" });
}

export function clearTab(tabId: number): void {
  state.delete(tabId);
}

export function isFrameRunActive(tabId: number, frameId: number, runId: string): boolean {
  const frameState = state.get(tabId)?.get(frameId);
  return frameState?.status === "running" && frameState.runId === runId;
}

export function getAggregatedStatus(configured: boolean, pageAvailable: boolean, frames: RunnerStatus[]): TabStatus {
  if (!pageAvailable) {
    return { configured, pageAvailable, status: "unavailable", frames };
  }
  if (frames.some((frame) => frame.status === "running")) {
    return { configured, pageAvailable, status: "running", frames };
  }
  if (frames.some((frame) => frame.status === "stopped")) {
    return { configured, pageAvailable, status: "stopped", frames };
  }
  return { configured, pageAvailable, status: "idle", frames };
}

function getTabMap(tabId: number): Map<number, FrameState> {
  let tab = state.get(tabId);
  if (!tab) {
    tab = new Map();
    state.set(tabId, tab);
  }
  return tab;
}
