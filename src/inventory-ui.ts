import { MATERIALS, MATERIAL_LABELS, type Manifest, type Palette } from './domain';
import {
  readStoredInventory,
  validateInventory,
  recommend,
  type Inventory,
  type Recommendation,
  type RecommendationMode,
  type ColorPreset,
  type RecommendationOptions,
} from './recommend';
const names = MATERIAL_LABELS;
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function inventoryUI(
  model: Manifest,
  presets: ColorPreset[],
  getPalette: () => Palette,
  apply: (p: Palette) => void,
  notify: (s: string) => void,
  persist = true,
) {
  const stored = readStoredInventory(persist ? localStorage : null);
  let inventory: Inventory = stored.inventory;
  /** Set while the stored data could not be read, so nothing overwrites it. */
  let preserveUnreadable = !stored.readable;
  if (stored.raw && !stored.readable) {
    // Keep the original bytes under a backup key before the editor writes anything.
    try {
      localStorage.setItem('color-studio:inventory:backup', stored.raw);
      notify(
        '已有耗材数据无法识别，原始内容已备份到 color-studio:inventory:backup，请导入 JSON 或重新录入',
      );
    } catch {
      notify('已有耗材数据无法识别，请导出备份或重新录入');
    }
  } else if (stored.dropped) {
    notify(`已有耗材中有 ${stored.dropped} 项无法识别，已跳过，其余记录保留`);
  }
  let seed: number | undefined;
  let mode: RecommendationMode = 'stock',
    plans: Recommendation[] = [];
  const dialog = document.createElement('dialog');
  dialog.id = 'inventory-dialog';
  dialog.className = 'inventory-dialog';
  dialog.innerHTML = `<div class="panel-title"><div><span class="eyebrow">WORK WITH WHAT YOU HAVE</span><h2>我的耗材与配色灵感</h2></div><button class="icon-button inventory-close" aria-label="关闭耗材窗口">×</button></div><div class="inventory-layout"><section><div class="inventory-heading"><h3>已有耗材 <span id="stock-count"></span></h3><button id="add-stock" class="button subtle">＋ 添加</button></div><div id="stock-list"></div><div class="inventory-actions"><button id="export-stock" class="text-button">导出库存 JSON</button><button id="import-stock" class="text-button">导入库存 JSON</button></div><input id="stock-file" type="file" accept="application/json,.json" hidden><p class="small-note">记录你实际拥有的耗材。名称、颜色与材质保存在此浏览器中；不会假设你拥有某卷耗材。改了颜色或材质后，联动的零件会一起更新。</p></section><section><div class="inventory-heading"><h3>配色推荐</h3><button id="shuffle-recommend" class="button subtle">↻ 换一换</button></div><div class="recommend-modes segmented"><button data-mode="stock" class="active">只用已有</button><button data-mode="add-one">补充一色</button><button data-mode="paint">丙烯点缀</button></div><p id="recommend-mode-note" class="small-note"></p><div id="recommend-list"></div></section></div>`;
  document.body.append(dialog);
  const q = <T extends HTMLElement = HTMLElement>(s: string) => dialog.querySelector<T>(s)!;
  function save() {
    try {
      // Never write over data that could not be read; the user has to edit or import first.
      if (persist && !preserveUnreadable)
        localStorage.setItem('color-studio:inventory', JSON.stringify(inventory));
    } catch {
      notify('无法自动保存库存，请导出 JSON 备份');
    }
    window.dispatchEvent(
      new CustomEvent('colorstudio:inventory', { detail: structuredClone(inventory) }),
    );
  }
  /** How many parts of the current look follow each spool; shows what a color change will touch. */
  function linkedCounts() {
    const counts = new Map<string, number>();
    for (const finish of Object.values(getPalette().parts))
      if (finish.stockId) counts.set(finish.stockId, (counts.get(finish.stockId) || 0) + 1);
    return counts;
  }
  function drawStock() {
    const linked = linkedCounts();
    q('#stock-count').textContent = `${inventory.items.length} 卷`;
    q('#stock-list').innerHTML = inventory.items.length
      ? inventory.items
          .map((i) => {
            const count = linked.get(i.id) || 0;
            return `<div class="stock-row" data-stock="${i.id}"><input type="color" value="${i.color}" data-field="color" aria-label="${esc(i.name)}颜色"><div><input class="stock-name" value="${esc(i.name)}" data-field="name" aria-label="耗材名称" maxlength="80"><select data-field="material" aria-label="${esc(i.name)}材质">${MATERIALS.map((m) => `<option value="${m}" ${m === i.material ? 'selected' : ''}>${names[m]}</option>`).join('')}</select>${count ? `<small class="stock-linked">已联动 ${count} 个零件 · 改色时会一起更新</small>` : ''}</div><button data-remove="${i.id}" class="icon-button" aria-label="移除${esc(i.name)}">×</button></div>`;
          })
          .join('')
      : '<div class="stock-empty">先添加你已有的耗材。<br>推荐会从真实库存开始。</div>';
  }
  function drawPlans() {
    q('#recommend-mode-note').textContent =
      mode === 'stock'
        ? '只匹配已有耗材；缺少 TPU 等必要材质会单独指出。'
        : mode === 'add-one'
          ? '优先已有库存，最多建议额外补一卷配色料；缺少的必要材质另列。'
          : '优先用现有料打印，仅为模型标记为可涂色的硬质外观件建议丙烯笔。';
    if (!inventory.items.length) {
      q('#recommend-list').innerHTML =
        '<div class="stock-empty">添加耗材后，会自动出现三组推荐。</div>';
      plans = [];
      return;
    }
    plans = recommend(model, getPalette(), inventory, presets, mode, { seed });
    q('#recommend-list').innerHTML = plans
      .map((p) => {
        const colors = model.colorGroups.map((g) => {
          const part =
            model.parts.find((x) => x.role === g.id && p.palette.parts[x.id].coating) ||
            model.parts.find((x) => x.role === g.id);
          const f = part ? p.palette.parts[part.id] : null;
          return f?.coating?.color || f?.color || '#ffffff';
        });
        return `<article class="recommend-card"><div class="recommend-head"><h4>${esc(p.name)}</h4><span>${p.complete ? '现有料可打印' : '需要补充耗材'}</span></div><div class="recommend-swatches">${colors.map((c) => `<span style="background:${c}"></span>`).join('')}</div><div class="recommend-uses">${p.used.map((x) => `<span><b style="background:${x.color}"></b><span data-user-content>${esc(x.name)}</span> · ${names[x.material]}</span>`).join('')}</div>${p.missing.length ? `<div class="missing-materials">${p.missing.map((x) => `<p><b style="background:${x.color}"></b>建议补 ${x.color} · ${names[x.material]}<small>${esc(x.reason)}</small></p>`).join('')}</div>` : ''}${p.paint.map((x) => `<div class="paint-advice">丙烯笔 ${x.color} · ${x.partIds.map((id) => esc(model.parts.find((y) => y.id === id)!.name)).join('、')}<small>保留已有打印本色，仅模拟表面涂色；先用试片验证附着。</small></div>`).join('')}${mode === 'paint' && !p.paint.length ? '<p class="small-note">这组配色无需额外丙烯点缀。</p>' : ''}<button class="button ${p.complete ? 'primary' : ''}" data-plan="${p.id}">${p.complete ? '预览这组配色' : '预览方案（需补料）'}</button></article>`;
      })
      .join('');
  }
  function setInventory(value: unknown) {
    inventory = validateInventory(value);
    // The user is authoring now: the unreadable payload is no longer protected.
    preserveUnreadable = false;
    save();
    drawStock();
    drawPlans();
    return structuredClone(inventory);
  }
  dialog.querySelector('.inventory-close')!.addEventListener('click', () => dialog.close());
  q('#shuffle-recommend').onclick = () => {
    if (!inventory.items.length) {
      notify('请先添加已有耗材');
      return;
    }
    const old = JSON.stringify(plans.map((p) => p.palette.parts));
    for (let attempt = 0; attempt < 5; attempt++) {
      seed = crypto.getRandomValues(new Uint32Array(1))[0];
      drawPlans();
      if (JSON.stringify(plans.map((p) => p.palette.parts)) !== old) {
        notify('已换一组新的配色灵感');
        return;
      }
    }
    notify('当前库存可组成的不同外观有限，可以增加颜色或试试补充一色。');
  };
  q('#add-stock').onclick = () => {
    const next = structuredClone(inventory);
    next.items.push({
      id: crypto.randomUUID(),
      name: `耗材 ${next.items.length + 1}`,
      color: '#F1EFE7',
      material: 'pla',
    });
    setInventory(next);
  };
  q('#stock-list').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement | HTMLSelectElement;
    const row = input.closest<HTMLElement>('[data-stock]');
    if (!row) return;
    const next = structuredClone(inventory);
    const i = next.items.find((x) => x.id === row.dataset.stock)!;
    Object.assign(i, { [input.dataset.field!]: input.value });
    try {
      setInventory(next);
    } catch (error) {
      notify((error as Error).message);
      drawStock();
    }
  });
  q('#stock-list').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-remove]');
    if (b)
      setInventory({
        ...inventory,
        items: inventory.items.filter((x) => x.id !== b.dataset.remove),
      });
  });
  dialog.querySelectorAll<HTMLElement>('[data-mode]').forEach(
    (b) =>
      (b.onclick = () => {
        mode = b.dataset.mode as RecommendationMode;
        dialog
          .querySelectorAll('[data-mode]')
          .forEach((x) => x.classList.toggle('active', x === b));
        drawPlans();
      }),
  );
  q('#recommend-list').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-plan]');
    const p = plans.find((p) => p.id === b?.dataset.plan);
    if (p) {
      apply(p.palette);
      dialog.close();
      notify(
        p.missing.length
          ? '已预览推荐配色；请按推荐清单补齐耗材。'
          : p.paint.length
            ? '已预览丙烯涂色效果，打印本色保留在方案中。'
            : '已使用库存耗材配色',
      );
    }
  });
  q('#export-stock').onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(inventory, null, 2) + '\n'], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-filaments.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  q('#import-stock').onclick = () => q<HTMLInputElement>('#stock-file').click();
  q<HTMLInputElement>('#stock-file').onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    try {
      if (f.size > 200_000) throw new Error('库存文件过大');
      setInventory(JSON.parse(await f.text()));
      notify('库存已导入');
    } catch (error) {
      notify((error as Error).message);
    }
    input.value = '';
  };
  return {
    open: () => {
      drawStock();
      drawPlans();
      dialog.showModal();
    },
    getInventory: () => structuredClone(inventory),
    setInventory,
    recommend: (m: RecommendationMode = 'stock', options: RecommendationOptions = {}) =>
      recommend(model, getPalette(), inventory, presets, m, options),
  };
}
