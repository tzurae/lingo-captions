function isRendered(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (!current.isConnected || current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (Number.parseFloat(style.opacity || '1') === 0) return false;
  }
  return true;
}

export function readRenderedCaptionText(pageDocument: Document): string {
  return Array.from(pageDocument.querySelectorAll('.ytp-caption-segment'))
    .filter(isRendered)
    .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
