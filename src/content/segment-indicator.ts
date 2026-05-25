import type { SegmentState } from "./node-registry";

const STYLE_ID = "llm-web-translator-segment-indicator-style";
const INDICATOR_CLASS = "llm-web-translator-segment-indicator";

export class SegmentIndicatorManager {
  private readonly indicators = new Map<string, HTMLSpanElement>();

  show(state: SegmentState): void {
    const anchor = resolveAnchor(state);
    if (!anchor) {
      this.hide(state.segmentId);
      return;
    }
    ensureStyles();
    const indicator = this.indicators.get(state.segmentId) ?? createIndicator();
    anchor.parent.insertBefore(indicator, anchor.reference);
    this.indicators.set(state.segmentId, indicator);
  }

  hide(segmentId: string): void {
    const indicator = this.indicators.get(segmentId);
    if (!indicator) return;
    indicator.remove();
    this.indicators.delete(segmentId);
  }

  clear(): void {
    for (const indicator of this.indicators.values()) {
      indicator.remove();
    }
    this.indicators.clear();
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.${INDICATOR_CLASS} {
  display: inline-block;
  width: 0.8em;
  height: 0.8em;
  margin-left: 0.35em;
  vertical-align: middle;
  border: 2px solid rgba(9, 105, 218, 0.25);
  border-top-color: #0969da;
  border-radius: 50%;
  animation: llm-web-translator-segment-spin 0.8s linear infinite;
  pointer-events: none;
  box-sizing: border-box;
}

@keyframes llm-web-translator-segment-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;
  document.head.appendChild(style);
}

function createIndicator(): HTMLSpanElement {
  const indicator = document.createElement("span");
  indicator.className = INDICATOR_CLASS;
  indicator.setAttribute("aria-hidden", "true");
  return indicator;
}

function resolveAnchor(state: SegmentState): { parent: Node; reference: ChildNode | null } | undefined {
  if (state.segment.kind === "safe-html") {
    const container = state.container;
    if (!container?.isConnected || !container.parentNode) return undefined;
    return {
      parent: container.parentNode,
      reference: container.nextSibling
    };
  }

  const targetNode = findWritableTextNode(state.nodes, state.expectedTexts ?? state.originalTexts);
  if (!targetNode?.isConnected || !targetNode.parentNode) return undefined;
  return {
    parent: targetNode.parentNode,
    reference: targetNode.nextSibling
  };
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
