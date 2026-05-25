import type {
  TranslateBatchAcceptedResponse,
  TranslateBatchMessage,
  TranslateBatchStreamChunkMessage,
  TranslateBatchStreamDoneMessage
} from "../shared/messages";
import type { SettingsView, TranslationSegment } from "../shared/types";
import { stableHash } from "../shared/hash";
import { collectCandidateRoots, scanVisibleSegments, type SegmentCandidate } from "./dom-scanner";
import { NodeRegistry, type SegmentState } from "./node-registry";

interface QueueItem {
  state: SegmentState;
}

interface PendingBatch {
  ids: string[];
}

const MAX_CONCURRENT_BATCH_REQUESTS = 3;
const VIEWPORT_SCAN_DELAY_MS = 120;
const COMPLETION_CHECK_DELAY_MS = 300;

export class TranslationRunner {
  private status: "idle" | "running" | "stopped" = "idle";
  private runId: string | undefined;
  private frameId = 0;
  private settings: SettingsView | undefined;
  private readonly registry = new NodeRegistry();
  private readonly queue: QueueItem[] = [];
  private readonly cache = new Map<string, string>();
  private readonly pendingBatches = new Map<string, PendingBatch>();
  private pendingFlush = false;
  private translatingCount = 0;
  private suppressMutations = false;
  private mutationObserver: MutationObserver | undefined;
  private pendingViewportScan = false;
  private pendingCompletionCheck = false;
  private batchSequence = 0;
  private mutationTick = 0;

  start(runId: string, frameId: number, settings: SettingsView): void {
    this.stop();
    this.status = "running";
    this.runId = runId;
    this.frameId = frameId;
    this.settings = settings;
    this.withSuppressedMutations(() => {
      this.registry.clear();
    });
    this.queue.length = 0;
    this.cache.clear();
    this.pendingBatches.clear();
    this.batchSequence = 0;
    this.mutationTick = 0;
    this.scanAndQueue(document.body);
    this.setupObservers();
    this.scheduleFlush();
    this.scheduleCompletionCheck();
  }

  stop(): void {
    this.status = this.status === "idle" ? "idle" : "stopped";
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;
    this.queue.length = 0;
    this.pendingBatches.clear();
    this.pendingViewportScan = false;
    this.pendingCompletionCheck = false;
    this.translatingCount = 0;
    this.withSuppressedMutations(() => {
      this.registry.clear();
    });
    window.removeEventListener("scroll", this.handleViewportChanged, true);
    window.removeEventListener("resize", this.handleViewportChanged);
    window.removeEventListener("load", this.handleWindowLoad);
  }

  getStatus() {
    return {
      frameId: this.frameId,
      runId: this.runId,
      status: this.status,
      pendingCount: this.queue.length,
      translatingCount: this.translatingCount
    };
  }

  handleBatchStreamChunk(message: TranslateBatchStreamChunkMessage): void {
    if (this.status !== "running" || !this.runId || message.runId !== this.runId || !this.settings) return;
    this.withSuppressedMutations(() => {
      for (const item of message.items) {
        const state = this.registry.get(item.id);
        if (!state) continue;
        if (item.done) {
          if (state.segment.kind === "text") {
            this.cache.set(cacheKey(state.segment, this.settings!.targetLanguage), item.text);
          }
          this.registry.applyFinalItem(message.runId, { id: item.id, text: item.text });
          continue;
        }
        if (state.segment.kind === "text") {
          this.registry.applyPartialText(message.runId, item.id, item.text);
        }
      }
    });
  }

  handleBatchStreamDone(message: TranslateBatchStreamDoneMessage): void {
    if (this.status !== "running" || !this.runId || message.runId !== this.runId) return;
    const batch = this.pendingBatches.get(message.batchId);
    if (!batch) return;

    this.withSuppressedMutations(() => {
      if (message.ok) {
        this.registry.markMissingFailed(this.runId!, batch.ids, new Set(message.completedIds));
      } else {
        this.registry.markFailed(this.runId!, batch.ids, message.error?.code ?? "API_BAD_RESPONSE");
      }
    });

    this.pendingBatches.delete(message.batchId);
    this.translatingCount = Math.max(0, this.translatingCount - 1);
    this.scheduleFlush();
    this.scheduleCompletionCheck();
  }

  async flush(): Promise<void> {
    if (this.status !== "running" || !this.settings || !this.runId) return;
    while (this.status === "running" && this.translatingCount < MAX_CONCURRENT_BATCH_REQUESTS) {
      const batch = this.takeBatch();
      if (batch.length === 0) break;
      const uncached = this.applyCachedItems(batch);
      if (uncached.length === 0) continue;
      this.translateBatch(uncached);
    }
    this.scheduleCompletionCheck();
  }

  private applyCachedItems(batch: QueueItem[]): QueueItem[] {
    if (!this.settings) return batch;
    return batch.filter((item) => {
      const translated = this.cache.get(cacheKey(item.state.segment, this.settings!.targetLanguage));
      if (!translated) return true;
      this.applySyntheticResult(item.state.segment.id, translated);
      return false;
    });
  }

  private translateBatch(uncached: QueueItem[]): void {
    if (!this.settings || !this.runId) return;
    const settings = this.settings;
    const runId = this.runId;
    const batchId = `${runId}:batch:${++this.batchSequence}`;
    const ids = uncached.map((item) => item.state.segmentId);

    this.translatingCount += 1;
    this.pendingBatches.set(batchId, { ids });
    this.withSuppressedMutations(() => {
      this.registry.markTranslating(ids);
    });

    const message: TranslateBatchMessage = {
      type: "TRANSLATE_BATCH",
      tabId: 0,
      frameId: this.frameId,
      runId,
      batchId,
      targetLanguage: settings.targetLanguage,
      segments: uncached.map((item) => item.state.segment)
    };

    void (async () => {
      try {
        const response = (await chrome.runtime.sendMessage(message)) as TranslateBatchAcceptedResponse | undefined;
        if (this.status !== "running" || this.runId !== runId) return;
        if (response?.ok && response.accepted) return;
        this.pendingBatches.delete(batchId);
        this.translatingCount = Math.max(0, this.translatingCount - 1);
        this.withSuppressedMutations(() => {
          this.registry.markFailed(runId, ids, response?.error?.code ?? "API_BAD_RESPONSE");
        });
        this.scheduleFlush();
        this.scheduleCompletionCheck();
      } catch {
        this.pendingBatches.delete(batchId);
        this.translatingCount = Math.max(0, this.translatingCount - 1);
        this.withSuppressedMutations(() => {
          this.registry.markFailed(runId, ids, "NETWORK_ERROR");
        });
        this.scheduleFlush();
        this.scheduleCompletionCheck();
      }
    })();
  }

  private scanAndQueue(root: ParentNode): number {
    if (this.status !== "running" || !this.runId) return 0;
    let added = 0;
    for (const candidate of scanVisibleSegments(root)) {
      if (this.enqueueCandidate(candidate)) added += 1;
    }
    return added;
  }

  private enqueueCandidate(candidate: SegmentCandidate): boolean {
    if (!this.runId) return false;
    const state: SegmentState = {
      segmentId: candidate.segment.id,
      runId: this.runId,
      segment: candidate.segment,
      nodes: candidate.nodes,
      container: candidate.container,
      originalTexts: candidate.nodes.map((node) => node.textContent ?? ""),
      expectedTexts: candidate.nodes.map((node) => node.textContent ?? ""),
      originalHtml: candidate.originalHtml,
      status: "pending"
    };
    let accepted = false;
    this.withSuppressedMutations(() => {
      accepted = this.registry.add(state);
      if (accepted) this.registry.markQueued(state.segmentId);
    });
    if (!accepted) return false;
    this.queue.push({ state });
    return true;
  }

  private takeBatch(): QueueItem[] {
    if (!this.settings) return [];
    const batch: QueueItem[] = [];
    let chars = 0;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      const nextChars = chars + item.state.segment.text.length;
      if (nextChars > this.settings.maxCharsPerBatch && batch.length > 0) {
        this.queue.unshift(item);
        break;
      }
      chars = nextChars;
      batch.push(item);
      if (nextChars >= this.settings.maxCharsPerBatch) break;
    }
    return batch;
  }

  private setupObservers(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      if (this.suppressMutations) return;
      let added = 0;
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          for (const root of collectCandidateRoots(node)) {
            added += this.scanAndQueue(root);
          }
        }
      }
      if (added > 0) this.mutationTick += 1;
      this.scheduleFlush();
      this.scheduleCompletionCheck();
    });

    this.mutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", this.handleViewportChanged, { capture: true, passive: true });
    window.addEventListener("resize", this.handleViewportChanged, { passive: true });
    window.addEventListener("load", this.handleWindowLoad, { once: true });
  }

  private readonly handleViewportChanged = (): void => {
    this.scheduleViewportScan();
  };

  private readonly handleWindowLoad = (): void => {
    this.scheduleCompletionCheck();
  };

  private scheduleViewportScan(): void {
    if (this.pendingViewportScan) return;
    this.pendingViewportScan = true;
    setTimeout(() => {
      this.pendingViewportScan = false;
      if (this.status !== "running") return;
      const added = this.scanAndQueue(document.body);
      if (added > 0) this.mutationTick += 1;
      this.scheduleFlush();
      this.scheduleCompletionCheck();
    }, VIEWPORT_SCAN_DELAY_MS);
  }

  private scheduleCompletionCheck(): void {
    if (this.pendingCompletionCheck || this.status !== "running") return;
    this.pendingCompletionCheck = true;
    const observedTick = this.mutationTick;
    setTimeout(() => {
      this.pendingCompletionCheck = false;
      if (this.status !== "running") return;
      if (this.mutationTick !== observedTick) {
        this.scheduleCompletionCheck();
        return;
      }
      if (this.queue.length > 0 || this.translatingCount > 0 || this.pendingBatches.size > 0) {
        return;
      }
      if (document.readyState !== "complete") {
        return;
      }
      this.finishCompletedRun();
    }, COMPLETION_CHECK_DELAY_MS);
  }

  private finishCompletedRun(): void {
    if (this.status !== "running") return;
    this.status = "stopped";
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;
    window.removeEventListener("scroll", this.handleViewportChanged, true);
    window.removeEventListener("resize", this.handleViewportChanged);
    window.removeEventListener("load", this.handleWindowLoad);
  }

  private scheduleFlush(): void {
    if (this.pendingFlush) return;
    this.pendingFlush = true;
    setTimeout(() => {
      this.pendingFlush = false;
      void this.flush();
    }, 50);
  }

  private applySyntheticResult(id: string, text: string): void {
    if (!this.runId) return;
    this.withSuppressedMutations(() => {
      this.registry.applyFinalItem(this.runId!, { id, text });
    });
  }

  private withSuppressedMutations(fn: () => void): void {
    this.suppressMutations = true;
    fn();
    queueMicrotask(() => {
      this.suppressMutations = false;
    });
  }
}

function cacheKey(segment: TranslationSegment, targetLanguage: string): string {
  return stableHash(`${targetLanguage}\n${segment.kind}\n${segment.text}`);
}
