export function isVisibleElement(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

export function queryFirst(selectors) {
  for (const selector of selectors) {
    try {
      const node = document.querySelector(selector);
      if (node) return node;
    } catch (_) {}
  }
  return null;
}

export function queryVisible(selectors) {
  for (const selector of selectors) {
    try {
      const nodes = Array.from(document.querySelectorAll(selector));
      const visibleNode = nodes.find((item) => isVisibleElement(item));
      if (visibleNode) return visibleNode;
    } catch (_) {}
  }
  return null;
}

export function queryVisibleByText(match) {
  const candidates = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], button, div, li'));
  return candidates.find((node) => {
    if (!isVisibleElement(node)) return false;
    return match((node.textContent || '').trim().toLowerCase(), node);
  }) || null;
}

export function clickElement(element) {
  if (!element) {
    throw new Error('element_not_found');
  }
  element.scrollIntoView({ behavior: 'instant', block: 'center' });
  element.click();
}

