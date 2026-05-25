import type { TranslationItem, TranslationSegment } from "../shared/types";
import { SegmentIndicatorManager } from "./segment-indicator";
import { validateAndBuildSafeFragment } from "./safe-html";

export interface SegmentState {
  segmentId: string;
  runId: string;
  segment: TranslationSegment;
  nodes: Text[];
  container?: Element;
  originalTexts: string[];
  expectedTexts?: string[];
  originalHtml?: string;
  status: "pending" | "queued" | "translating" | "translated" | "failed";
  errorMessage?: string;
}

export class NodeRegistry {
  private readonly states = new Map<string, SegmentState>();
  private nodeState = new WeakMap<Text, SegmentState>();
  private containerState = new WeakMap<Element, SegmentState>();
  private readonly indicators = new SegmentIndicatorManager();

  add(state: SegmentState): boolean {
    if (state.nodes.some((node) => this.nodeState.has(node))) return false;
    if (state.container && this.containerState.has(state.container)) return false;
    this.states.set(state.segmentId, state);
    for (const node of state.nodes) this.nodeState.set(node, state);
    if (state.container) this.containerState.set(state.container, state);
    this.syncIndicator(state);
    return true;
  }

  get(segmentId: string): SegmentState | undefined {
    return this.states.get(segmentId);
  }

  hasNode(node: Text): boolean {
    return this.nodeState.has(node);
  }

  markQueued(segmentId: string): void {
    const state = this.states.get(segmentId);
    if (!state) return;
    state.status = "queued";
    this.syncIndicator(state);
  }

  markTranslating(ids: string[]): void {
    for (const id of ids) {
      const state = this.states.get(id);
      if (!state) continue;
      state.status = "translating";
      this.syncIndicator(state);
    }
  }

  applyItems(runId: string, items: TranslationItem[]): void {
    for (const item of items) {
      this.applyFinalItem(runId, item);
    }
  }

  applyPartialText(runId: string, id: string, translated: string): void {
    const state = this.states.get(id);
    if (!state || state.runId !== runId || state.segment.kind !== "text") return;
    if (!state.nodes.every((node) => node.isConnected)) {
      state.status = "failed";
      state.errorMessage = "NODE_CHANGED";
      this.syncIndicator(state);
      return;
    }
    this.applyText(state, translated, false);
  }

  applyFinalItem(runId: string, item: TranslationItem): void {
    const state = this.states.get(item.id);
    if (!state || state.runId !== runId || state.status === "translated") return;
    if (!state.nodes.every((node) => node.isConnected)) {
      state.status = "failed";
      state.errorMessage = "NODE_CHANGED";
      this.syncIndicator(state);
      return;
    }
    if (state.segment.kind === "safe-html") {
      this.applySafeHtml(state, item.text);
      return;
    }
    this.applyText(state, item.text, true);
  }

  markMissingFailed(runId: string, requestedIds: string[], returnedIds: Set<string>): void {
    for (const id of requestedIds) {
      if (returnedIds.has(id)) continue;
      const state = this.states.get(id);
      if (state?.runId === runId) {
        state.status = "failed";
        state.errorMessage = "API_BAD_RESPONSE";
        this.syncIndicator(state);
      }
    }
  }

  markFailed(runId: string, requestedIds: string[], errorMessage: string): void {
    for (const id of requestedIds) {
      const state = this.states.get(id);
      if (state?.runId === runId) {
        state.status = "failed";
        state.errorMessage = errorMessage;
        this.syncIndicator(state);
      }
    }
  }

  clear(): void {
    this.indicators.clear();
    this.states.clear();
    this.nodeState = new WeakMap<Text, SegmentState>();
    this.containerState = new WeakMap<Element, SegmentState>();
  }

  private syncIndicator(state: SegmentState): void {
    if (state.status === "translated" || state.status === "failed") {
      this.indicators.hide(state.segmentId);
      return;
    }
    this.indicators.show(state);
  }

  private applyText(state: SegmentState, translated: string, finalize: boolean): void {
    if (!state.nodes.length) {
      state.status = "failed";
      state.errorMessage = "NODE_CHANGED";
      this.syncIndicator(state);
      return;
    }
    const expectedTexts = state.expectedTexts ?? state.originalTexts;
    if (!state.nodes.every((node, index) => node.textContent === expectedTexts[index])) {
      state.status = "failed";
      state.errorMessage = "NODE_CHANGED";
      this.syncIndicator(state);
      return;
    }
    const targetNode = findWritableTextNode(state.nodes, expectedTexts);
    if (!targetNode) {
      state.status = "failed";
      state.errorMessage = "NODE_CHANGED";
      this.syncIndicator(state);
      return;
    }
    targetNode.textContent = translated;
    state.expectedTexts = state.nodes.map((node) => node.textContent ?? "");
    state.status = finalize ? "translated" : "translating";
    this.syncIndicator(state);
  }

  private applySafeHtml(state: SegmentState, translatedHtml: string): void {
    if (!state.container || !state.originalHtml) {
      state.status = "failed";
      state.errorMessage = "HTML_STRUCTURE_CHANGED";
      this.syncIndicator(state);
      return;
    }
    if (state.container.innerHTML !== state.originalHtml) {
      state.status = "failed";
      state.errorMessage = "NODE_CHANGED";
      this.syncIndicator(state);
      return;
    }
    const safe = validateAndBuildSafeFragment(state.originalHtml, translatedHtml);
    if (!safe) {
      state.status = "failed";
      state.errorMessage = "HTML_UNSAFE";
      this.syncIndicator(state);
      return;
    }
    state.container.replaceChildren(safe);
    state.status = "translated";
    this.syncIndicator(state);
  }
}

function findWritableTextNode(nodes: Text[], originalTexts: string[]): Text | undefined {
  const significantIndexes = originalTexts
    .map((text, index) => ({ text, index }))
    .filter((entry) => entry.text.replace(/\s+/g, "").trim().length > 0)
    .map((entry) => entry.index);

  if (significantIndexes.length === 1) {
    return nodes[significantIndexes[0]!];
  }

  return nodes.length === 1 ? nodes[0] : undefined;
}
