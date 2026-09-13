import { translateText, type Locale } from './translations';
export let locale: Locale = 'zh-CN';
const originals = new WeakMap<Node, { source: string; shown: string }>();
const attributes = new WeakMap<Element, Map<string, { source: string; shown: string }>>();
let observer: MutationObserver | null = null;
export const t = (s: string) => translateText(s, locale);
/** Localize only presentation text. Never mutate IDs, input values, geometry or saved user data. */
export function localize(root: HTMLElement = document.body) {
  observer?.disconnect();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('script,style,pre,code,[data-user-content]')) continue;
    const current = node.nodeValue || '',
      old = originals.get(node);
    const source = old && current === old.shown ? old.source : current;
    const shown = translateText(source, locale);
    originals.set(node, { source, shown });
    if (shown !== current) node.nodeValue = shown;
  }
  for (const el of [
    root,
    ...root.querySelectorAll<HTMLElement>('[placeholder],[aria-label],[title]'),
  ]) {
    if (el.closest('[data-user-content]')) continue;
    const cache = attributes.get(el) || new Map();
    for (const key of ['placeholder', 'aria-label', 'title']) {
      const current = el.getAttribute(key);
      if (current === null) continue;
      const old = cache.get(key),
        source = old && current === old.shown ? old.source : current;
      const shown = translateText(source, locale);
      cache.set(key, { source, shown });
      if (shown !== current) el.setAttribute(key, shown);
    }
    attributes.set(el, cache);
  }
  document.documentElement.lang = locale;
  observer?.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'aria-label', 'title'],
  });
}
export function setLocale(value: Locale) {
  locale = value;
  try {
    localStorage.setItem('color-studio:locale', value);
  } catch {
    /* Locale is still usable without storage. */
  }
  localize();
  const button = document.getElementById('language-toggle');
  if (button) {
    document.getElementById('language-label')!.textContent = locale === 'en' ? 'English' : '中文';
    button.setAttribute(
      'aria-label',
      locale === 'en'
        ? 'Current language: English. Switch to Chinese'
        : '当前语言：中文。切换到英文',
    );
  }
  window.dispatchEvent(new CustomEvent('colorstudio:locale', { detail: locale }));
}
export function installI18n() {
  const requested = new URLSearchParams(location.search).get('lang');
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('color-studio:locale');
  } catch {}
  locale = requested === 'en' || (requested !== 'zh-CN' && saved === 'en') ? 'en' : 'zh-CN';
  observer = new MutationObserver(() => localize());
  setLocale(locale);
  document
    .getElementById('language-toggle')!
    .addEventListener('click', () => setLocale(locale === 'en' ? 'zh-CN' : 'en'));
}
