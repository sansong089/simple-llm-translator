import type { TranslationSegment } from "../shared/types";
import { stableHash } from "../shared/hash";
import { isSafeHtmlContainer } from "./safe-html";
import { shouldTranslateText } from "./text-filter";

export interface SegmentCandidate {
  segment: TranslationSegment;
  nodes: Text[];
  container?: Element;
  originalHtml?: string;
}

export interface ScanOptions {
  viewport?: {
    backScreens: number;
    forwardScreens: number;
  };
  maxChars?: number;
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "PRE", "CODE", "KBD", "SAMP"]);

export function scanVisibleSegments(root: ParentNode = document.body, options: ScanOptions = {}): SegmentCandidate[] {
  const candidates: SegmentCandidate[] = [];
  const handledContainers = new Set<Element>();
  let chars = 0;

  const addCandidate = (candidate: SegmentCandidate): boolean => {
    const nextChars = chars + candidate.segment.text.length;
    if (options.maxChars && nextChars > options.maxChars && candidates.length > 0) return false;
    chars = nextChars;
    candidates.push(candidate);
    return true;
  };

  for (const element of Array.from(root.querySelectorAll("a,button,label,td,th,li,p,h1,h2,h3,h4,h5,h6"))) {
    if (
      element instanceof Element &&
      !isInsideHandledContainer(element, handledContainers) &&
      isVisibleElement(element, options) &&
      isSafeHtmlContainer(element)
    ) {
      const candidate = analyzeSafeContainer(element);
      if (candidate) {
        handledContainers.add(element);
        const added = addCandidate(candidate);
        if (!added) return candidates;
      }
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent ?? "";
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (isInsideHandledContainer(parent, handledContainers)) return NodeFilter.FILTER_REJECT;
      if (!isTranslatableParent(parent)) return NodeFilter.FILTER_REJECT;
      if (!isVisibleElement(parent, options)) return NodeFilter.FILTER_REJECT;
      if (!shouldTranslateText(text)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const text = textNode.textContent ?? "";
    const added = addCandidate({
      segment: {
        id: createSegmentId("text", text),
        kind: "text",
        text,
        context: contextForElement(textNode.parentElement)
      },
      nodes: [textNode]
    });
    if (!added) break;
  }

  return candidates;
}

export function collectCandidateRoots(node: Node): Element[] {
  if (node instanceof Element) return [node];
  if (node.parentElement) return [node.parentElement];
  return [];
}

function collectTextNodes(root: ParentNode): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

function analyzeSafeContainer(element: Element): SegmentCandidate | null {
  const text = element.textContent ?? "";
  if (!shouldTranslateText(text)) return null;

  const html = element.innerHTML;
  const textNodes = collectTextNodes(element);
  const textNodeCount = countSignificantTextNodes(textNodes);

  if (textNodeCount <= 1) {
    return {
      segment: {
        id: createSegmentId("text", text),
        kind: "text",
        text,
        context: contextForElement(element)
      },
      nodes: textNodes
    };
  }

  if (!html.includes("<")) return null;

  return {
    segment: {
      id: createSegmentId("html", html),
      kind: "safe-html",
      text: html,
      context: contextForElement(element)
    },
    nodes: textNodes,
    container: element,
    originalHtml: html
  };
}

function countSignificantTextNodes(nodes: Text[]): number {
  return nodes.filter((node) => visibleText(node.textContent ?? "")).length;
}

function visibleText(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

function isInsideHandledContainer(element: Element, containers: Set<Element>): boolean {
  let current: Element | null = element;
  while (current) {
    if (containers.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function isTranslatableParent(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (SKIP_TAGS.has(current.tagName)) return false;
    if ((current as HTMLElement).isContentEditable) return false;
    current = current.parentElement;
  }
  return true;
}

function isVisibleElement(element: Element, options: ScanOptions): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  if (options.viewport) {
    const backBuffer = window.innerHeight * options.viewport.backScreens;
    const forwardBuffer = window.innerHeight * options.viewport.forwardScreens;
    if (rect.bottom < -backBuffer || rect.top > window.innerHeight + forwardBuffer) return false;
  }
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function createSegmentId(kind: string, text: string): string {
  return `${kind}-${stableHash(text)}-${Math.random().toString(36).slice(2, 7)}`;
}

function contextForElement(element: Element | null): TranslationSegment["context"] {
  if (!element) return "text";
  if (/^H[1-6]$/.test(element.tagName)) return "heading";
  if (element.tagName === "BUTTON") return "button";
  if (element.tagName === "LABEL") return "label";
  if (element.tagName === "TD" || element.tagName === "TH") return "table-cell";
  return "text";
}
