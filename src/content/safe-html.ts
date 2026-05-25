const SAFE_CONTAINER_TAGS = new Set(["A", "BUTTON", "LABEL", "TD", "TH", "LI", "P", "H1", "H2", "H3", "H4", "H5", "H6"]);
const SAFE_INLINE_TAGS = new Set(["SPAN", "STRONG", "EM", "B", "I", "A"]);
const DANGEROUS_ATTRS = new Set(["STYLE", "SRCDOC"]);

export function isSafeHtmlContainer(element: Element): boolean {
  if (!SAFE_CONTAINER_TAGS.has(element.tagName)) return false;
  return Array.from(element.childNodes).every(isSafeChild);
}

export function validateAndBuildSafeFragment(originalHtml: string, translatedHtml: string): DocumentFragment | null {
  const original = parseFragment(originalHtml);
  const translated = parseFragment(translatedHtml);
  if (!sameStructure(original, translated)) return null;
  if (!isSafeFragment(translated)) return null;
  return cloneSafeFragment(translated);
}

function isSafeChild(node: ChildNode): boolean {
  if (node.nodeType === Node.TEXT_NODE) return true;
  if (!(node instanceof Element)) return false;
  if (!SAFE_INLINE_TAGS.has(node.tagName)) return false;
  return Array.from(node.childNodes).every(isSafeChild);
}

function parseFragment(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function sameStructure(original: ParentNode, translated: ParentNode): boolean {
  const originalElements = elementShape(original);
  const translatedElements = elementShape(translated);
  if (originalElements.length !== translatedElements.length) return false;
  return originalElements.every((item, index) => {
    const other = translatedElements[index];
    if (!other) return false;
    if (item.path !== other.path || item.tagName !== other.tagName) return false;
    if (item.attrs.length !== other.attrs.length) return false;
    return item.attrs.every((attr, attrIndex) => attr === other.attrs[attrIndex]);
  });
}

function elementShape(root: ParentNode): Array<{ path: string; tagName: string; attrs: string[] }> {
  const result: Array<{ path: string; tagName: string; attrs: string[] }> = [];
  walk(root, "", result);
  return result;
}

function walk(node: ParentNode, path: string, result: Array<{ path: string; tagName: string; attrs: string[] }>): void {
  Array.from(node.childNodes).forEach((child, index) => {
    if (child instanceof Element) {
      const childPath = `${path}/${index}`;
      result.push({
        path: childPath,
        tagName: child.tagName,
        attrs: Array.from(child.attributes)
          .map((attr) => `${attr.name}=${attr.value}`)
          .sort()
      });
      walk(child, childPath, result);
    }
  });
}

function isSafeFragment(fragment: DocumentFragment): boolean {
  return Array.from(fragment.childNodes).every((node) => {
    if (node.nodeType === Node.TEXT_NODE) return true;
    if (!(node instanceof Element)) return false;
    if (!SAFE_INLINE_TAGS.has(node.tagName)) return false;
    if (!safeAttributes(node)) return false;
    return Array.from(node.childNodes).every((child) => isSafeNode(child));
  });
}

function isSafeNode(node: ChildNode): boolean {
  if (node.nodeType === Node.TEXT_NODE) return true;
  if (!(node instanceof Element)) return false;
  return SAFE_INLINE_TAGS.has(node.tagName) && safeAttributes(node) && Array.from(node.childNodes).every(isSafeNode);
}

function safeAttributes(element: Element): boolean {
  return Array.from(element.attributes).every((attr) => {
    const name = attr.name.toUpperCase();
    const value = attr.value.trim().toLowerCase();
    if (name.startsWith("ON")) return false;
    if (DANGEROUS_ATTRS.has(name)) return false;
    if (value.startsWith("javascript:")) return false;
    return true;
  });
}

function cloneSafeFragment(fragment: DocumentFragment): DocumentFragment {
  const safe = document.createDocumentFragment();
  for (const child of Array.from(fragment.childNodes)) {
    safe.appendChild(child.cloneNode(true));
  }
  return safe;
}
