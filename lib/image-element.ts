const MIN_IMAGE_SIDE = 40;
const MIN_IMAGE_AREA = 12_000;

function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function hasExcludedAncestor(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (
      current.matches(
        '[data-fast-ai-translator], button, [role="button"], [aria-hidden="true"], [role="presentation"], [role="none"]',
      )
    ) {
      return true;
    }
    current = composedParent(current);
  }
  return false;
}

export function isEligibleImage(
  element: Element,
  view: Window | null = element.ownerDocument.defaultView,
): element is HTMLImageElement {
  if (!(element instanceof HTMLImageElement) || !element.isConnected) return false;
  if (hasExcludedAncestor(element)) return false;

  const rect = element.getBoundingClientRect();
  if (
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < MIN_IMAGE_SIDE ||
    rect.height < MIN_IMAGE_SIDE ||
    rect.width * rect.height < MIN_IMAGE_AREA
  ) {
    return false;
  }

  const viewportWidth = Math.max(1, view?.innerWidth ?? 1);
  const viewportHeight = Math.max(1, view?.innerHeight ?? 1);
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewportWidth || rect.top >= viewportHeight) {
    return false;
  }

  const style = view?.getComputedStyle(element);
  return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
}

export function findEligibleImage(
  path: readonly EventTarget[],
  view?: Window | null,
): HTMLImageElement | undefined {
  for (const target of path) {
    if (target instanceof Element && isEligibleImage(target, view ?? target.ownerDocument.defaultView)) {
      return target;
    }
  }
  return undefined;
}
