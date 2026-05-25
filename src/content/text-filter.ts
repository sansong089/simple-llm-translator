const urlPattern = /^https?:\/\/\S+$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashPattern = /^[a-f0-9]{16,}$/i;
const machinePattern = /^[a-zA-Z_$][\w$.-]*(?:[/\\][\w$.-]+)+$/;
const variablePattern = /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+$/;

export function shouldTranslateText(text: string): boolean {
  const trimmed = text.trim();
  if (visibleLength(trimmed) < 2) return false;
  if (/^\d+$/.test(trimmed)) return false;
  if (/^[\p{P}\p{S}\s]+$/u.test(trimmed)) return false;
  if (urlPattern.test(trimmed)) return false;
  if (emailPattern.test(trimmed)) return false;
  if (hashPattern.test(trimmed)) return false;
  if (machinePattern.test(trimmed)) return false;
  if (variablePattern.test(trimmed)) return false;
  return true;
}

export function visibleLength(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}
