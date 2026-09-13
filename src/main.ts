import { installI18n, locale, t } from './i18n';
import type { ColorStudioAPI } from './api';
import { inventoryUI } from './inventory-ui';
import { manifestPath, presets } from './models/active';
import './style.css';
import {
  createIcons,
  Github,
  Search,
  RotateCcw,
  RotateCw,
  Download,
  Upload,
  Camera,
  ChevronDown,
  Box,
  SlidersHorizontal,
  Layers,
  Sun,
  MousePointer2,
  Check,
  ArrowUpRight,
  X,
  Palette as PaletteIcon,
  Maximize,
  Eye,
  Code,
  Undo2,
  Redo2,
} from 'lucide';
import {
  EditorState,
  defaults,
  validatePalette,
  isColor,
  MATERIALS,
  type Manifest,
  type Palette,
  type Lighting,
  type MaterialKind,
} from './domain';
import { Viewer } from './viewer';
const isDemo = new URLSearchParams(location.search).get('demo') === '1';
const icons = {
  Github,
  Search,
  RotateCcw,
  RotateCw,
  Download,
  Upload,
  Camera,
  ChevronDown,
  Box,
  SlidersHorizontal,
  Layers,
  Sun,
  MousePointer2,
  Check,
  ArrowUpRight,
  X,
  Palette: PaletteIcon,
  Maximize,
  Eye,
  Code,
  Undo2,
  Redo2,
};
const icon = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const labels: Record<MaterialKind, string> = {
  pla: 'PLA',
  'matte-pla': '哑光 PLA',
  petg: 'PETG',
  tpu: 'TPU',
};
$('#app').innerHTML = `
<header class="topbar"><a class="brand" href="./"><span class="brand-mark">μ</span><span>microduck<span class="brand-sub">COLOR STUDIO</span></span></a><span class="header-divider"></span><span class="project-label">给你的小鸭子，一点个性。</span><div class="top-actions"><a class="project-github button subtle" href="https://github.com/LathamZ/microduck-color-studio" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 查看项目" title="在 GitHub 查看项目">${icon('github')}<span>GitHub</span></a><button id="language-toggle" class="language-toggle" type="button" aria-label="Switch to English">EN</button><span id="save-status" class="saved">本地自动保存</span><button id="inventory-open" class="button subtle inventory-open">我的耗材</button><button id="import" class="button subtle">${icon('upload')}<span>导入</span></button><button id="export" class="button primary">${icon('download')}<span>导出方案</span></button></div></header>
<main class="workspace">
<aside class="parts-panel"><div class="panel-title"><h2>零件</h2><span id="part-count" class="count">—</span></div><label class="search">${icon('search')}<input id="search" type="search" placeholder="搜索零件或 ID" aria-label="搜索零件"></label><div class="part-filters"><button data-filter="printable" class="active">打印件</button><button data-filter="all">全部</button></div><div id="part-list" class="part-list"></div><div class="parts-footer">${icon('mouse-pointer-2')} 点击模型，也能选择零件</div></aside>
<section class="stage"><div class="stage-top"><div><div class="eyebrow">YOUR LITTLE COMPANION</div><h1>让每一面，都像你。</h1><span id="model-name" class="model-label">正在载入装配模型</span></div><span class="live-tag"><b></b> 实时 3D</span></div><div id="viewport"><div id="loading"><span class="loader"></span><span>正在组装你的小鸭子…</span></div></div><div class="stage-tools"><button class="icon-button" id="undo" aria-label="撤销" title="撤销">${icon('undo-2')}</button><button class="icon-button" id="redo" aria-label="重做" title="重做">${icon('redo-2')}</button><span></span><button class="icon-button" id="screenshot" aria-label="导出效果图" title="导出效果图">${icon('camera')}</button><button class="icon-button" id="fit" aria-label="恢复默认视角" title="恢复默认视角">${icon('maximize')}</button></div><div class="stage-bottom"><div class="view-controls"><button data-view="three-quarter" class="active">立体</button><button data-view="front">正面</button><button data-view="left">侧面</button><button data-view="back">背面</button></div><span class="gesture">拖动旋转 · 滚轮缩放</span></div><div class="stage-caption"><span>真实装配模型 · 外观预览</span><span id="selection-caption">选中零件后，可在右侧单独调色</span></div></section>
<aside class="inspector"><div class="inspector-scroll"><div class="panel-title"><h2>外观实验室</h2>${icon('sliders-horizontal')}</div><div class="selected-heading"><span class="eyebrow">SELECTED PART</span><h3 id="selected-name">选择一个零件</h3><div id="selected-meta" class="meta">直接点击模型，或从左侧选择</div></div><div id="part-editor"><label class="field-label" for="part-color">零件颜色 <span id="color-code">#F1EFE7</span></label><div class="color-entry"><input type="color" id="part-color" value="#f1efe7" aria-label="零件颜色"><input id="hex-color" value="#F1EFE7" maxlength="7" aria-label="十六进制颜色"><button id="apply-role" class="text-button" title="应用到相同配色分组">同组应用</button></div><div class="field-label reference-heading">常用参考色</div><div id="quick-colors" class="quick-colors"></div><section id="owned-materials" class="owned-materials"></section><label class="field-label">打印材质</label><div class="material-options">${MATERIALS.map((m) => `<button data-material="${m}">${labels[m]}</button>`).join('')}</div><p id="material-description" class="small-note"></p><label class="check-row"><input type="checkbox" id="same-source"> 同名零件一起调整</label><div class="part-actions"><button id="isolate" class="button subtle">${icon('eye')} 单独查看</button><button id="reset-part" class="button subtle">${icon('rotate-ccw')} 还原</button></div></div><hr><div class="section-heading">${icon('sun')} 灯光与表面</div><div class="segmented light-options"><button data-light="studio" class="active">摄影棚</button><button data-light="daylight">日光</button><button data-light="warm">暖光</button></div><label class="field-label" for="intensity">光线强度 <output id="intensity-value">100%</output></label><input id="intensity" type="range" min="30" max="180" value="100"><label class="field-label" for="direction">光源方向 <output id="direction-value">−35°</output></label><input id="direction" type="range" min="-180" max="180" value="-35"><label class="check-row"><input id="layers" type="checkbox" checked> 模拟 0.2 mm 打印层纹</label><p class="small-note">光泽与层纹为近似模拟，非耗材实测；层纹按装配竖直方向展示。</p><hr><div class="section-heading">${icon('layers')} 装配视图</div><label class="field-label" for="explode">零件展开 <output id="explode-value">0%</output></label><input id="explode" type="range" min="0" max="100" value="0"><label class="check-row"><input id="hardware" type="checkbox" checked> 显示舵机与电子零件</label><p class="small-note model-note">原版 XL330 步行模型。HD1910 改件尺寸与轮滑件不在此预览中。</p></div><button id="agent-info" class="agent-link">${icon('code')} Agent 接口与开放格式 ${icon('arrow-up-right')}</button></aside>
<section class="palette-tray"><div class="palette-title"><span class="eyebrow">A GOOD START</span><h2>从一组喜欢的颜色开始</h2><span>套用后，还能逐件调整</span><button id="recommend-open" class="recommend-open">按我的耗材推荐 ↗</button></div><div class="preset-list">${presets.map((p, i) => `<button class="preset ${i === 0 ? 'active' : ''}" data-preset="${i}"><span class="swatch-strip">${p.colors.map((c) => `<span style="background:${c}"></span>`).join('')}</span><span class="preset-name">${p.name}</span><span class="preset-tag">${p.tag}</span></button>`).join('')}</div><div class="group-colors"><span>整体微调</span>${['主色', '结构', '点缀'].map((n, i) => `<label><input type="color" data-role-color="${['primary', 'structure', 'accent'][i]}" value="${presets[0].colors[i]}" aria-label="${n}颜色"><span>${n}</span></label>`).join('')}</div></section>
</main><footer class="footer"><span>Made for humans. Ready for agents. <a href="https://github.com/LathamZ/microduck-color-studio" target="_blank" rel="noopener noreferrer">GitHub ↗</a></span><span>模型：Pollen Robotics · CC BY-NC-SA 4.0 <a href="./NOTICE.md" target="_blank" rel="noopener">来源与许可 ↗</a></span></footer>
<div id="toast" role="status" aria-live="polite"></div><input type="file" id="import-file" accept="application/json,.json" hidden><dialog id="agent-dialog"><div class="panel-title"><h2>给 Agent 的入口</h2><button id="close-dialog" class="icon-button" aria-label="关闭">${icon('x')}</button></div><p>稳定零件 ID、可校验的 JSON 方案，以及浏览器中的显式 API。</p><div class="api-links"><a href="./models/parts.json" target="_blank">零件清单 ↗</a><a href="./palette.schema.json" target="_blank">方案 JSON Schema ↗</a><a href="./agent-api.md" target="_blank">API 文档 ↗</a></div><pre>window.colorStudio.getModel()
window.colorStudio.getPalette()
window.colorStudio.updateParts(
  [partId],
  { color: '#F28C28', material: 'petg' }
)
window.colorStudio.setLighting({
  preset: 'studio', intensity: 1.2, azimuth: 45
})</pre><p class="small-note">只更改当前网页的配色。不会修改打印工程，也不会发送打印任务。</p></dialog>`;
createIcons({ icons });
installI18n();
let inventoryManager: ReturnType<typeof inventoryUI> | null = null;
let state: EditorState,
  viewer: Viewer,
  model: Manifest,
  selected: string | null = null,
  filter = 'printable',
  isolated = false,
  light = 'studio';
let toastTimer: ReturnType<typeof setTimeout>;
function toast(s: string) {
  $('#toast').textContent = s;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3500);
}
function save() {
  if (isDemo) return;
  try {
    localStorage.setItem(`color-studio:${model.modelId}`, JSON.stringify(state.palette));
    $('#save-status').textContent = '已保存到此浏览器';
  } catch {
    $('#save-status').textContent = '自动保存不可用，请导出方案';
  }
}
function drawList() {
  const q = $<HTMLInputElement>('#search').value.trim().toLowerCase();
  const parts = model.parts.filter(
    (p) =>
      (filter === 'all' || p.printable) &&
      [p.name, t(p.name), p.id, p.assembly, t(p.assembly)].join(' ').toLowerCase().includes(q),
  );
  $('#part-count').textContent = String(parts.length);
  const assemblies = [...new Set(parts.map((p) => p.assembly))];
  $('#part-list').innerHTML = parts.length
    ? assemblies
        .map(
          (a) =>
            `<details open><summary>${escape(a)}<span>${parts.filter((p) => p.assembly === a).length}</span></summary>${parts
              .filter((p) => p.assembly === a)
              .map(
                (p) =>
                  `<button class="part-row ${selected === p.id ? 'selected' : ''}" data-part="${p.id}" aria-pressed="${selected === p.id}"><span class="part-swatch" style="background:${state.palette.parts[p.id].color}"></span><span>${escape(p.name)}</span>${!p.printable ? '<small>硬件</small>' : ''}</button>`,
              )
              .join('')}</details>`,
        )
        .join('')
    : '<div class="empty">没有找到匹配零件</div>';
}
function select(id: string) {
  if (!state.palette.parts[id]) throw new Error('未知零件');
  selected = id;
  if (isolated) {
    viewer.isolate(id);
  }
  viewer.select(id);
  syncInspector();
  drawList();
  window.dispatchEvent(new CustomEvent('colorstudio:selection', { detail: { id } }));
}
function renderOwned() {
  const host = $('#owned-materials');
  if (!host || !selected) return;
  const p = model.parts.find((x) => x.id === selected)!;
  const f = state.palette.parts[selected];
  const items = inventoryManager?.getInventory().items || [];
  const match = items.find(
    (x) => x.color.toUpperCase() === f.color.toUpperCase() && x.material === f.material,
  );
  const compatible = items.filter((x) => (p.defaultMaterial === 'tpu') === (x.material === 'tpu'));
  host.innerHTML = `<div class="owned-heading"><span>我的已有耗材</span><button class="text-button" data-stock-manage>管理 ↗</button></div>${!p.printable ? '<p class="small-note">标准硬件不使用打印耗材。</p>' : !items.length ? '<p class="small-note">导入库存后，这里会单独展示已有的颜色和材质。</p>' : `<div class="stock-match ${match ? 'in-stock' : 'not-stock'}">${match ? '✓ 已有此颜色与材质' : '库存未记录此组合 · 需补充或替换'}</div><div class="owned-chips">${compatible.map((i) => `<button data-owned="${i.id}" class="owned-chip ${match?.id === i.id ? 'active' : ''}"><b style="background:${i.color}"></b><span><span data-user-content>${escape(i.name)}</span><small>${labels[i.material]}</small></span></button>`).join('') || '<p class="small-note">库存中没有适合此零件的材质。</p>'}</div>`}`;
  host.querySelector<HTMLElement>('[data-stock-manage]')!.onclick = () => inventoryManager?.open();
  host.querySelectorAll<HTMLElement>('[data-owned]').forEach(
    (b) =>
      (b.onclick = () => {
        const i = items.find((x) => x.id === b.dataset.owned)!;
        patch({ color: i.color, material: i.material });
      }),
  );
  document.querySelectorAll<HTMLElement>('[data-quick]').forEach((b) => {
    const owned = items.some((i) => i.color.toUpperCase() === b.dataset.quick?.toUpperCase());
    b.classList.toggle('owned-reference', owned);
    b.title = owned ? '库存已有此色，请在已有耗材中选定材质' : '参考色，库存未记录';
  });
}
function syncInspector() {
  renderOwned();
  const disabled = !selected;
  $('#part-editor').classList.toggle('disabled', disabled);
  $('#part-editor')
    .querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')
    .forEach((e) => (e.disabled = disabled));
  if (!selected) return;
  const p = model.parts.find((x) => x.id === selected)!;
  const f = state.palette.parts[selected];
  $('#selected-name').textContent = p.name;
  $('#selected-meta').textContent = `${p.assembly} · ${p.printable ? '打印件' : '标准硬件'}`;
  $('#selected-meta').title = p.id;
  $('#selection-caption').textContent = `${p.name} · ${labels[f.material]}`;
  $<HTMLInputElement>('#part-color').value = f.color;
  $<HTMLInputElement>('#hex-color').value = f.color;
  $('#color-code').textContent = f.color.toUpperCase();
  document.querySelectorAll<HTMLButtonElement>('[data-material]').forEach((e) => {
    e.classList.toggle('active', e.dataset.material === f.material);
    e.disabled = !p.printable;
  });
  $('#material-description').classList.toggle('coating-note', !!f.coating);
  $('#material-description').textContent = f.coating
    ? `丙烯涂色 ${f.coating.color} · 打印本色 ${f.color}。修改零件颜色可移除涂色。`
    : !p.printable
      ? '标准硬件可调显示颜色，打印材质不适用于硬件。'
      : {
          pla: '柔和高光，适中的表面光泽。',
          'matte-pla': '更分散的反射，柔和、低光泽的表面。',
          petg: '更集中的高光与更明显的表面反射。',
          tpu: '柔和的橡胶质感；不模拟柔性变形。',
        }[f.material];
}
function syncLighting() {
  const l = state.palette.lighting;
  light = l.preset;
  $<HTMLInputElement>('#intensity').value = String(l.intensity * 100);
  $<HTMLInputElement>('#direction').value = String(l.azimuth);
  $('#intensity-value').textContent = Math.round(l.intensity * 100) + '%';
  $('#direction-value').textContent = l.azimuth + '°';
  $<HTMLInputElement>('#layers').checked = state.palette.surface.layers;
  document
    .querySelectorAll<HTMLElement>('[data-light]')
    .forEach((x) => x.classList.toggle('active', x.dataset.light === light));
  viewer.light(light, l.intensity, l.azimuth);
}
function setLighting(patch: Partial<Lighting>) {
  const p = structuredClone(state.palette);
  p.lighting = { ...p.lighting, ...patch };
  state.commit(p);
  update();
}
function update() {
  syncLighting();
  viewer.apply(state.palette, state.palette.surface.layers);
  drawList();
  syncInspector();
  $<HTMLButtonElement>('#undo').disabled = !state.canUndo;
  $<HTMLButtonElement>('#redo').disabled = !state.canRedo;
  save();
  document
    .querySelectorAll<HTMLElement>('[data-preset]')
    .forEach((e) =>
      e.classList.toggle('active', presets[Number(e.dataset.preset)].name === state.palette.name),
    );
  document.querySelectorAll<HTMLInputElement>('[data-role-color]').forEach((e) => {
    const p = model.parts.find((p) => p.role === e.dataset.roleColor);
    if (p) e.value = state.palette.parts[p.id].color;
  });
  window.dispatchEvent(
    new CustomEvent('colorstudio:change', { detail: structuredClone(state.palette) }),
  );
}
function targets() {
  if (!selected) return [];
  if (!$<HTMLInputElement>('#same-source').checked) return [selected];
  const source = model.parts.find((p) => p.id === selected)!.sourceName;
  return model.parts.filter((p) => p.sourceName === source).map((p) => p.id);
}
function patch(p: Parameters<EditorState['update']>[1]) {
  state.update(targets(), p);
  update();
}
function download(data: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function bind() {
  $('#part-list').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-part]');
    if (b) select(b.dataset.part!);
  });
  $('#search').addEventListener('input', drawList);
  document.querySelectorAll<HTMLElement>('[data-filter]').forEach(
    (e) =>
      (e.onclick = () => {
        filter = e.dataset.filter!;
        document
          .querySelectorAll('[data-filter]')
          .forEach((x) => x.classList.toggle('active', x === e));
        drawList();
      }),
  );
  $<HTMLInputElement>('#part-color').addEventListener('input', (e) => {
    const color = (e.target as HTMLInputElement).value;
    $('#hex-color').setAttribute('value', color);
    $('#color-code').textContent = color.toUpperCase();
    const temp = structuredClone(state.palette);
    for (const id of targets()) temp.parts[id].color = color;
    viewer.apply(temp, $<HTMLInputElement>('#layers').checked);
  });
  $<HTMLInputElement>('#part-color').addEventListener('change', (e) =>
    patch({ color: (e.target as HTMLInputElement).value }),
  );
  $<HTMLInputElement>('#hex-color').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (isColor(input.value)) patch({ color: input.value });
    else {
      toast('请输入 #RRGGBB 格式的颜色');
      syncInspector();
    }
  });
  $('#quick-colors').innerHTML = [
    '#F1EFE7',
    '#30343B',
    '#F28C28',
    '#F2C94C',
    '#8DAB8A',
    '#254D70',
    '#ECC6C5',
    '#3AC9BD',
  ]
    .map(
      (c) =>
        `<button style="background:${c}" data-quick="${c}" aria-label="使用颜色 ${c}"></button>`,
    )
    .join('');
  $('#quick-colors').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-quick]');
    if (b) patch({ color: b.dataset.quick! });
  });
  document
    .querySelectorAll<HTMLElement>('[data-material]')
    .forEach((e) => (e.onclick = () => patch({ material: e.dataset.material as MaterialKind })));
  $('#apply-role').onclick = () => {
    if (!selected) return;
    const role = model.parts.find((p) => p.id === selected)!.role;
    state.update(
      model.parts.filter((p) => p.role === role).map((p) => p.id),
      { color: state.palette.parts[selected].color },
    );
    update();
    toast('颜色已应用到同组零件');
  };
  $('#reset-part').onclick = () => {
    if (selected) {
      const p = structuredClone(state.palette);
      const d = defaults(model);
      for (const id of targets()) p.parts[id] = d.parts[id];
      state.commit(p);
      update();
    }
  };
  $('#isolate').onclick = () => {
    isolated = !isolated;
    viewer.isolate(isolated ? selected : null);
    if (!isolated) viewer.hardware($<HTMLInputElement>('#hardware').checked);
    $('#isolate').classList.toggle('active', isolated);
  };
  $('#undo').onclick = () => {
    state.undo();
    update();
  };
  $('#redo').onclick = () => {
    state.redo();
    update();
  };
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(
    (e) =>
      (e.onclick = () => {
        viewer.view(e.dataset.view!);
        document
          .querySelectorAll('[data-view]')
          .forEach((x) => x.classList.toggle('active', x === e));
      }),
  );
  $('#fit').onclick = () => viewer.view('three-quarter');
  $('#screenshot').onclick = () => {
    const a = document.createElement('a');
    a.href = viewer.png();
    a.download = `${model.modelId}-preview.png`;
    a.click();
    toast('效果图已导出');
  };
  document.querySelectorAll<HTMLElement>('[data-preset]').forEach(
    (e) =>
      (e.onclick = () => {
        const preset = presets[Number(e.dataset.preset)];
        const p = structuredClone(state.palette);
        p.name = preset.name;
        for (const part of model.parts) {
          const i = model.colorGroups.findIndex((g) => g.id === part.role);
          if (i !== -1) p.parts[part.id].color = preset.colors[i];
        }
        state.commit(p);
        update();
        toast(`已套用「${preset.name}」`);
      }),
  );
  document.querySelectorAll<HTMLInputElement>('[data-role-color]').forEach(
    (e) =>
      (e.onchange = () => {
        state.update(
          model.parts.filter((p) => p.role === e.dataset.roleColor).map((p) => p.id),
          { color: e.value },
        );
        update();
      }),
  );
  const previewLighting = () => {
    const intensity = Number($<HTMLInputElement>('#intensity').value);
    const direction = Number($<HTMLInputElement>('#direction').value);
    $('#intensity-value').textContent = intensity + '%';
    $('#direction-value').textContent = direction + '°';
    viewer.light(light, intensity / 100, direction);
  };
  document
    .querySelectorAll<HTMLElement>('[data-light]')
    .forEach(
      (e) => (e.onclick = () => setLighting({ preset: e.dataset.light as Lighting['preset'] })),
    );
  $('#intensity').oninput = previewLighting;
  $('#direction').oninput = previewLighting;
  $('#intensity').onchange = () =>
    setLighting({ intensity: Number($<HTMLInputElement>('#intensity').value) / 100 });
  $('#direction').onchange = () =>
    setLighting({ azimuth: Number($<HTMLInputElement>('#direction').value) });
  $('#layers').onchange = () => {
    const p = structuredClone(state.palette);
    p.surface.layers = $<HTMLInputElement>('#layers').checked;
    state.commit(p);
    update();
  };
  $('#explode').oninput = () => {
    const x = Number($<HTMLInputElement>('#explode').value);
    viewer.explode(x / 100);
    $('#explode-value').textContent = x + '%';
  };
  $('#hardware').onchange = () => {
    if (isolated) {
      isolated = false;
      viewer.isolate(null);
      $('#isolate').classList.remove('active');
    }
    viewer.hardware($<HTMLInputElement>('#hardware').checked);
  };
  $('#export').onclick = () =>
    download(
      JSON.stringify(state.palette, null, 2) + '\n',
      `${model.modelId}-palette.json`,
      'application/json',
    );
  $('#import').onclick = () => $<HTMLInputElement>('#import-file').click();
  $<HTMLInputElement>('#import-file').onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    try {
      if (f.size > 1_000_000) throw new Error('方案文件不得超过 1 MB');
      state.commit(validatePalette(JSON.parse(await f.text()), model));
      update();
      toast('方案已导入');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      input.value = '';
    }
  };
  $('#agent-info').onclick = () => $<HTMLDialogElement>('#agent-dialog').showModal();
  $('#close-dialog').onclick = () => $<HTMLDialogElement>('#agent-dialog').close();
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input,textarea')) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      e.shiftKey ? state.redo() : state.undo();
      update();
    }
  });
}
async function init() {
  try {
    const response = await fetch(
      new URL(manifestPath, new URL(import.meta.env.BASE_URL, location.href)),
    );
    if (!response.ok) throw new Error('无法读取模型清单');
    model = await response.json();
    state = new EditorState(model);
    try {
      const stored = isDemo ? null : localStorage.getItem(`color-studio:${model.modelId}`);
      if (stored) {
        state.palette = validatePalette(JSON.parse(stored), model);
        for (const p of model.parts) {
          if (p.defaultColor === '#000000' && state.palette.parts[p.id].color === '#535960')
            state.palette.parts[p.id].color = '#000000';
        }
      }
    } catch {
      toast('之前的本地方案不可用，已恢复默认配色');
    }
    viewer = new Viewer($('#viewport'), model, select);
    await viewer.load(
      new URL(
        model.geometryUrl,
        new URL(manifestPath, new URL(import.meta.env.BASE_URL, location.href)),
      ).href,
    );
    $('#loading').remove();
    $('.group-colors').innerHTML =
      '<span>整体微调</span>' +
      model.colorGroups
        .map((g) => {
          const p = model.parts.find((p) => p.role === g.id);
          return `<label><input type="color" data-role-color="${escape(g.id)}" value="${p?.defaultColor || '#ffffff'}" aria-label="${escape(g.name)}颜色"><span>${escape(g.name)}</span></label>`;
        })
        .join('');
    $('.model-note').textContent = model.uiNote;
    $('#model-name').textContent = `${model.name} · ${model.parts.length} 个独立零件`;
    bind();
    update();
    const first =
      model.parts.find((p) => p.role === model.colorGroups[0]?.id) ||
      model.parts.find((p) => p.printable);
    if (first) select(first.id);
    const stock = inventoryUI(
      model,
      presets,
      () => state.palette,
      (p) => {
        state.commit(p);
        update();
      },
      toast,
      !isDemo,
    );
    inventoryManager = stock;
    renderOwned();
    window.addEventListener('colorstudio:inventory', renderOwned);
    $('#inventory-open').onclick = stock.open;
    $('#recommend-open').onclick = stock.open;
    const api: ColorStudioAPI = {
      version: 1,
      getInventory: stock.getInventory,
      setInventory: stock.setInventory,
      recommend: stock.recommend,
      getModel: () => structuredClone(model),
      getPalette: () => structuredClone(state.palette),
      importPalette: (p: unknown) => {
        state.commit(validatePalette(p, model));
        update();
        return api.getPalette();
      },
      updateParts: (ids: string[], p: Parameters<EditorState['update']>[1]) => {
        state.update(ids, p);
        update();
        return api.getPalette();
      },
      setLighting: (patch: Partial<Lighting>) => {
        setLighting(patch);
        return api.getPalette();
      },
      setSurface: (surface: { layers: boolean }) => {
        const p = structuredClone(state.palette);
        p.surface = surface;
        state.commit(p);
        update();
        return api.getPalette();
      },
      selectPart: (id: string) => select(id),
      setView: (name: string) => viewer.view(name),
      undo: () => {
        state.undo();
        update();
      },
      redo: () => {
        state.redo();
        update();
      },
    };
    Object.defineProperty(window, 'colorStudio', { value: Object.freeze(api), configurable: true });
    window.dispatchEvent(new Event('colorstudio:ready'));
    if (isDemo) {
      const { setupDemo } = await import('./demo');
      setupDemo(
        model,
        viewer,
        (p) => {
          state.commit(p);
          update();
        },
        select,
        stock,
      );
    }
  } catch (error) {
    $('#loading').innerHTML =
      `<strong>模型加载失败</strong><span>${escape((error as Error).message)}</span><button onclick="location.reload()" class="button">重新加载</button>`;
    console.error(error);
  }
}
init();
