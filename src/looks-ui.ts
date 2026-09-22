import { locale } from './i18n';
import type { Manifest, Palette } from './domain';
import {
  MAX_LOOKS,
  lookPalette,
  parseLooks,
  readLooks,
  relativeTime,
  samePalette,
  suggestedName,
  writeLooks,
  type SavedLook,
} from './looks';
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `look-${Math.floor(Math.random() * 1e12).toString(36)}`;
/** Saved looks: save the current colors, switch between them, and keep them in this browser. */
export function looksUI(
  model: Manifest,
  getPalette: () => Palette,
  apply: (palette: Palette) => void,
  notify: (message: string) => void,
  persist = true,
) {
  const storage = (() => {
    try {
      return persist ? localStorage : null;
    } catch {
      return null;
    }
  })();
  let looks: SavedLook[] = readLooks(model, storage, Date.now());
  let pendingDelete: string | null = null;
  let renaming: string | null = null;
  let deleteTimer: ReturnType<typeof setTimeout> | undefined;
  const panel = document.createElement('div');
  panel.id = 'looks-menu';
  panel.className = 'looks-menu';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '我的配色方案');
  panel.tabIndex = -1;
  panel.hidden = true;
  panel.innerHTML = `<div class="looks-head"><div><span class="eyebrow">SAVED LOOKS</span><h3>我的配色方案</h3></div><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="looks-save"><input id="looks-name" maxlength="60" placeholder="给这套配色起个名字" aria-label="方案名称" autocomplete="off"><button id="looks-save-button" class="button primary">保存当前配色</button></div><p id="looks-hint" class="small-note" role="status"></p><div id="looks-list" class="looks-list"></div>`;
  // Anchor to the top-bar toggle when present so the panel opens under it.
  (document.querySelector('.looks-split') || document.body).append(panel);
  const q = <T extends HTMLElement = HTMLElement>(s: string) => panel.querySelector<T>(s)!;
  const swatches = (palette: Palette) =>
    model.colorGroups
      .map((group) => {
        const part =
          model.parts.find((p) => p.role === group.id && palette.parts[p.id].coating) ||
          model.parts.find((p) => p.role === group.id);
        const finish = part ? palette.parts[part.id] : null;
        return finish?.coating?.color || finish?.color || '#f1efe7';
      })
      .map((color) => `<span style="background:${color}"></span>`)
      .join('');
  const activeLook = () => looks.find((l) => samePalette(l.palette, getPalette()));
  function persistLooks() {
    if (persist && !writeLooks(model, storage, looks))
      notify('本地保存不可用，请导出 JSON 备份你的方案');
  }
  function draw() {
    const current = getPalette();
    const active = activeLook();
    q('#looks-list').innerHTML = looks.length
      ? looks
          .map(
            (look) =>
              `<article class="look-row ${active?.id === look.id ? 'active' : ''}" data-look="${look.id}"><button class="look-apply" data-apply="${look.id}" aria-pressed="${active?.id === look.id}"><span class="look-strip">${swatches(look.palette)}</span><span class="look-meta">${
                renaming === look.id
                  ? `<input class="look-rename" data-rename-input="${look.id}" value="${esc(look.name)}" maxlength="60" aria-label="方案名称">`
                  : `<b data-user-content>${esc(look.name)}</b>`
              }<small>${esc(relativeTime(look.savedAt, Date.now(), locale))}</small></span><span class="look-state">${active?.id === look.id ? '当前' : '套用'}</span></button><div class="look-tools"><button data-rename="${look.id}">重命名</button><button data-overwrite="${look.id}">用当前配色覆盖</button><button data-delete="${look.id}" class="${pendingDelete === look.id ? 'confirm' : ''}">${pendingDelete === look.id ? '确认删除' : '删除'}</button></div></article>`,
          )
          .join('')
      : '<div class="looks-empty">还没有保存的方案。<br>调好颜色后点「保存当前配色」，随时一键切回。</div>';
    q('#looks-hint').textContent = active
      ? `当前配色与「${active.name}」一致，共保存 ${looks.length} 套。`
      : looks.length
        ? '当前配色有改动，保存后会新增一套或覆盖同名方案。'
        : `配色方案保存在此浏览器，最多 ${MAX_LOOKS} 套。`;
    const name = q<HTMLInputElement>('#looks-name');
    const exists = looks.some((l) => l.name === name.value.trim());
    q('#looks-save-button').textContent = exists ? '覆盖同名方案' : '保存当前配色';
    if (renaming === null) name.placeholder = suggestedName(current.name, looks.length + 1);
  }
  function save(name: string) {
    const label = name.trim().slice(0, 60);
    if (!label) {
      notify('请先给这套配色起个名字');
      q<HTMLInputElement>('#looks-name').focus();
      return;
    }
    const palette = structuredClone(getPalette());
    palette.name = label;
    const at = Date.now();
    const existing = looks.find((l) => l.name === label);
    if (existing) {
      existing.palette = palette;
      existing.savedAt = at;
    } else {
      looks.unshift({ id: newId(), name: label, savedAt: at, palette });
      looks = looks.slice(0, MAX_LOOKS);
    }
    apply(palette);
    persistLooks();
    q<HTMLInputElement>('#looks-name').value = '';
    draw();
    notify(existing ? `已用当前配色覆盖「${label}」` : `已保存「${label}」`);
  }
  function toggle(open?: boolean) {
    const next = open === undefined ? panel.hidden : open;
    if (!next) {
      panel.hidden = true;
      document.getElementById('looks-toggle')?.setAttribute('aria-expanded', 'false');
      return;
    }
    const current = getPalette();
    q<HTMLInputElement>('#looks-name').value = '';
    q<HTMLInputElement>('#looks-name').placeholder = suggestedName(current.name, looks.length + 1);
    renaming = null;
    pendingDelete = null;
    draw();
    panel.hidden = false;
    document.getElementById('looks-toggle')?.setAttribute('aria-expanded', 'true');
    panel.focus();
  }
  panel.querySelector('[data-close]')!.addEventListener('click', () => toggle(false));
  panel.addEventListener('input', (event) => {
    if ((event.target as HTMLElement).id === 'looks-name') draw();
  });
  q<HTMLInputElement>('#looks-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      save((event.target as HTMLInputElement).value);
    }
  });
  q('#looks-save-button').addEventListener('click', () =>
    save(q<HTMLInputElement>('#looks-name').value),
  );
  q('#looks-list').addEventListener('click', (event) => {
    const target = event.target as Element;
    const id = target.closest<HTMLElement>('[data-look]')?.dataset.look;
    if (!id) return;
    if (target.closest('[data-apply]')) {
      const look = looks.find((l) => l.id === id)!;
      // A scheme carries colors, materials, coatings and filament links. How you are looking
      // at the duck — the light, the layer-line shading — stays exactly as you left it.
      apply(lookPalette(look, getPalette()));
      draw();
      notify(`已套用「${look.name}」`);
      return;
    }
    if (target.closest('[data-rename]')) {
      renaming = id;
      draw();
      const input = q<HTMLInputElement>(`[data-rename-input="${id}"]`);
      input.focus();
      input.select();
      return;
    }
    if (target.closest('[data-overwrite]')) {
      const look = looks.find((l) => l.id === id)!;
      look.palette = structuredClone(getPalette());
      look.palette.name = look.name;
      look.savedAt = Date.now();
      persistLooks();
      draw();
      notify(`已用当前配色覆盖「${look.name}」`);
      return;
    }
    if (target.closest('[data-delete]')) {
      if (pendingDelete !== id) {
        pendingDelete = id;
        clearTimeout(deleteTimer);
        deleteTimer = setTimeout(() => {
          if (pendingDelete === id) {
            pendingDelete = null;
            draw();
          }
        }, 4000);
        draw();
        notify('再点一次即可删除这套方案');
        return;
      }
      const look = looks.find((l) => l.id === id)!;
      looks = looks.filter((l) => l.id !== id);
      pendingDelete = null;
      clearTimeout(deleteTimer);
      persistLooks();
      draw();
      notify(`已删除「${look.name}」`);
    }
  });
  const commitRename = (id: string, value: string) => {
    if (renaming !== id) return;
    renaming = null;
    const look = looks.find((l) => l.id === id);
    const label = value.trim().slice(0, 60);
    if (look && label && label !== look.name) {
      look.name = label;
      persistLooks();
      notify(`已重命名为「${label}」`);
    }
    draw();
  };
  q('#looks-list').addEventListener(
    'keydown',
    (event) => {
      const input = (event.target as Element).closest<HTMLInputElement>('[data-rename-input]');
      if (!input) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        commitRename(input.dataset.renameInput!, input.value);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        renaming = null;
        draw();
      }
    },
    true,
  );
  q('#looks-list').addEventListener('focusout', (event) => {
    const input = (event.target as Element).closest<HTMLInputElement>('[data-rename-input]');
    if (input) commitRename(input.dataset.renameInput!, input.value);
  });
  /**
   * Close on an outside click or Escape. Uses the dispatch path rather than the live DOM:
   * row actions re-render the list inside their own handler, so by the time this listener
   * runs the clicked button is detached and `closest()` would report "outside".
   */
  const isInside = (event: Event) => {
    const path = event.composedPath();
    const toggleButton = document.getElementById('looks-toggle');
    return path.includes(panel) || (!!toggleButton && path.includes(toggleButton));
  };
  document.addEventListener('click', (event) => {
    if (!panel.hidden && !isInside(event)) toggle(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    toggle(false);
    document.getElementById('looks-toggle')?.focus();
  });
  return {
    toggle,
    refresh: draw,
    /** Deep copies for callers and agents; they can never mutate editor state in place. */
    list: () => parseLooks(structuredClone(looks), model, Date.now()),
    save,
    apply(id: string) {
      const look = looks.find((l) => l.id === id);
      if (!look) throw new Error('未找到该配色方案');
      const palette = lookPalette(look, getPalette());
      apply(palette);
      draw();
      return palette;
    },
  };
}
