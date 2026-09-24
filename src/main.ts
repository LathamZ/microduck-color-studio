import { mobilePreview } from './device';
import { installI18n, locale, t } from './i18n';
import type { ColorStudioAPI } from './api';
import { inventoryUI } from './inventory-ui';
import { manifestPath, presets } from './models/active';
import './style.css';
import {
  createIcons,
  Globe,
  Shuffle,
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
  Minimize,
  Focus,
  Eye,
  Code,
  Undo2,
  Redo2,
  Footprints,
} from 'lucide';
import {
  EditorState,
  MODULES,
  defaults,
  isFitted,
  type ModuleName,
  repairPalette,
  validatePalette,
  isColor,
  ELEVATION_RANGE,
  MATERIALS,
  MATERIAL_LABELS,
  type Manifest,
  type Palette,
  type Lighting,
  type LightPattern,
  type MaterialKind,
} from './domain';
import { LIGHT_RIGS, Viewer } from './viewer';
import { looksUI } from './looks-ui';
import { MOTION_LABELS, type MotionName } from './motion';
const isDemo = new URLSearchParams(location.search).get('demo') === '1';
/** Which set of feet is fitted. Remembered in this browser, the way the language is. */
const MODULE_KEY = 'color-studio:module';
let module: ModuleName = 'walk';
const readModule = (): ModuleName => {
  if (isDemo) return 'walk';
  try {
    const stored = localStorage.getItem(MODULE_KEY);
    return MODULES.includes(stored as ModuleName) ? (stored as ModuleName) : 'walk';
  } catch {
    return 'walk';
  }
};
/** Actions that need a foot flat on the floor, which skates do not have. */
const GROUND_MOTIONS: MotionName[] = ['walk', 'sit', 'kick', 'grab', 'recover'];
/** Actions that need wheels under you instead. */
const SKATE_MOTIONS: MotionName[] = ['skate', 'sprint', 'turn', 'brake'];
const icons = {
  Globe,
  Shuffle,
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
  Minimize,
  Focus,
  Eye,
  Code,
  Undo2,
  Redo2,
  Footprints,
};
const icon = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
/** Lucide turns `data-lucide` placeholders into svg, so any markup built after the first pass
 *  has to ask for it again — otherwise the button keeps an empty element and looks blank. */
const renderIcons = () => createIcons({ icons });
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const labels = MATERIAL_LABELS;
/** Appearance notes for every printable material. Approximations, never measured data. */
const materialNotes: Record<MaterialKind, string> = {
  pla: '柔和高光，适中的表面光泽。',
  'matte-pla': '更分散的反射，柔和、低光泽的表面。',
  'silk-pla': '丝绸般的光泽与柔和流动感，层纹依然可见。',
  'pla-cf': '碳纤维填充 PLA 的低光泽外观；不模拟编织碳布。',
  petg: '更集中的高光与更明显的表面反射。',
  'matte-petg': '低光泽、柔和漫反射的 PETG 外观。',
  'metallic-petg': '金属色泽与较集中的高光；为外观模拟。',
  'petg-cf': '碳纤 PETG 的哑光颗粒感，比普通 PETG 更少反光。',
  abs: '工程塑料的半哑光表面，略带光泽，比 PLA 更耐热。',
  asa: '户外工程塑料，细腻哑光，耐候优于 ABS。',
  pc: '高强度工程塑料，高光泽与更深的反射。',
  pa: '尼龙特有的细腻绒感与半哑光表面，韧性好。',
  'pa-cf': '碳纤尼龙的深色哑光表面，刚性好、层纹更明显。',
  tpu: '柔和的橡胶质感；不模拟柔性变形。',
};
/** Each light preset also moves the lamps, the backdrop and the tone-mapping exposure. */
const lightNotes: Record<Lighting['preset'], string> = {
  studio: '中性白顶光加冷色补光：高光集中、阴影干净，最接近商品图。',
  daylight: '高角度暖白日光加天空环境光：整体更亮，阴影短而清晰。',
  warm: '低角度橙色暖光配暖米色背景：阴影被拉长，明暗对比更强。',
  cinema: '纯黑场景只留布光，像拍人像一样给模型打光。',
};
/** How each setup places the key, fill and rim lamps. `standard` keeps the preset's own. */
const stageCaptions: Record<Lighting['preset'], string> = {
  studio: '真实装配模型 · 外观预览',
  daylight: '真实装配模型 · 外观预览',
  warm: '真实装配模型 · 外观预览',
  cinema: '电影布光 · 外观预览',
};
const patternNotes: Record<LightPattern | 'standard', string> = {
  standard: '跟随当前灯光的默认布光。',
  butterfly: '蝴蝶光：主光从正面偏高处打下，正面干净、轮廓对称。',
  rembrandt: '伦勃朗光：主光在斜上方 45°，暗面留下三角形光斑。',
  split: '分割光：硬侧光把模型劈成明暗两半，戏剧感最强。',
  rim: '轮廓光：主光从背后勾亮边缘，正面只留一点补光。',
};
$('#app').innerHTML = `
<header class="topbar"><a class="brand" href="./"><span class="brand-mark"><img src="${import.meta.env.BASE_URL}icon.svg" alt="" width="42" height="42"></span><span>microduck<span class="brand-sub">COLOR STUDIO</span></span></a><span class="header-divider"></span><span class="project-label">给你的小鸭子，一点个性。</span><div class="top-actions"><span id="save-status" class="saved">本地自动保存</span><a class="project-github button subtle" href="https://github.com/LathamZ/microduck-color-studio" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 查看项目" title="在 GitHub 查看项目">${icon('github')}</a><button id="inventory-open" class="button subtle inventory-open">我的耗材</button><div class="looks-split"><button id="looks-toggle" class="button subtle looks-toggle" aria-haspopup="dialog" aria-expanded="false" title="保存与切换配色方案"><span class="looks-text"><span class="looks-title">配色方案</span><span class="looks-label" id="looks-label" data-user-content>默认配色</span></span>${icon('chevron-down')}</button></div><button id="import" class="button subtle">${icon('upload')}<span>导入</span></button><div class="export-split"><button id="export" class="button primary" title="导出 JSON 配色配置">${icon('download')}<span>导出</span></button><button id="export-menu-toggle" class="button primary export-arrow" aria-label="更多导出选项" aria-haspopup="menu" aria-expanded="false" aria-controls="export-menu">${icon('chevron-down')}</button><div id="export-menu" role="menu" hidden><button id="export-print-open" role="menuitem">导出 3D 打印模型</button></div></div><button id="language-toggle" class="language-toggle" type="button" aria-label="切换语言">${icon('globe')}<span id="language-label" data-user-content>中文</span></button></div></header>
<main class="workspace">
<aside class="parts-panel"><div class="panel-title"><h2>零件</h2><span id="part-count" class="count">—</span></div><label class="search">${icon('search')}<input id="search" type="search" placeholder="搜索零件或 ID" aria-label="搜索零件"></label><div class="part-filters"><button data-filter="printable" class="active">打印件</button><button data-filter="all">全部</button></div><div id="part-list" class="part-list"></div><div class="parts-footer">${icon('mouse-pointer-2')} 点击模型，也能选择零件</div></aside>
<section class="stage"><div class="stage-top"><div><div class="eyebrow">YOUR LITTLE COMPANION</div><div class="slogan-row"><h1 id="slogan">小鸭子，也有大脾气。</h1><button id="shuffle-slogan" class="icon-button" aria-label="换一句标语" title="换一句标语">${icon('shuffle')}</button></div><span id="model-name" class="model-label">正在载入装配模型</span></div><span class="live-tag"><b></b> 实时 3D</span></div><div id="viewport"><div id="loading"><span class="loader"></span><span>正在组装你的小鸭子…</span></div></div><div class="stage-tools"><button class="icon-button" id="undo" aria-label="撤销" title="撤销">${icon('undo-2')}</button><button class="icon-button" id="redo" aria-label="重做" title="重做">${icon('redo-2')}</button><span></span><button class="icon-button" id="screenshot" aria-label="导出效果图" title="导出效果图">${icon('camera')}</button><div class="motion-tools"><button class="icon-button" id="motion-toggle" aria-label="让它动起来" title="让它动起来" aria-haspopup="menu" aria-expanded="false">${icon('footprints')}</button><div id="motion-menu" role="menu" hidden><span class="eyebrow">动作</span><button data-motion="sequence" role="menuitem">循环播放（默认）</button><button data-motion="walk" role="menuitem">走路</button><button data-motion="skate" role="menuitem">滑行</button><button data-motion="sprint" role="menuitem">加速</button><button data-motion="turn" role="menuitem">转弯</button><button data-motion="brake" role="menuitem">刹车</button><button data-motion="sit" role="menuitem">坐下站起</button><button data-motion="kick" role="menuitem">踢一下</button><button data-motion="grab" role="menuitem">叼一口</button><button data-motion="recover" role="menuitem">翻身站起</button><button data-motion="shake" role="menuitem">摇头</button><button data-motion="tilt" role="menuitem">歪头</button><button data-motion="beak" role="menuitem">张嘴</button></div></div><button class="icon-button" id="fit" aria-label="恢复默认视角" title="恢复默认视角">${icon('focus')}</button><button class="icon-button" id="fullscreen" aria-label="全屏查看" title="全屏查看">${icon('maximize')}</button></div><div class="stage-bottom"><div class="stage-controls"><div class="view-controls"><button data-view="three-quarter" class="active">立体</button><button data-view="front">正面</button><button data-view="left">侧面</button><button data-view="back">背面</button></div><div class="view-controls module-controls"><button id="module-toggle" title="装上或拆下轮滑模组">轮滑</button></div></div><span class="gesture">拖动旋转 · 滚轮缩放</span></div><div class="stage-caption"><span id="stage-mode-caption">真实装配模型 · 外观预览</span><span id="selection-caption">选中零件后，可在右侧单独调色</span></div></section>
<aside class="inspector"><div class="inspector-scroll"><div class="panel-title"><h2>外观实验室</h2>${icon('sliders-horizontal')}</div><div class="selected-heading"><span class="eyebrow">SELECTED PART</span><h3 id="selected-name">选择一个零件</h3><div id="selected-meta" class="meta">直接点击模型，或从左侧选择</div></div><div id="part-editor"><label class="field-label" for="part-color">零件颜色 <span id="color-code">#F1EFE7</span></label><div class="color-entry"><input type="color" id="part-color" value="#f1efe7" aria-label="零件颜色"><input id="hex-color" value="#F1EFE7" maxlength="7" aria-label="十六进制颜色"><button id="apply-role" class="text-button" title="应用到相同配色分组">同组应用</button></div><div class="field-label reference-heading">常用参考色</div><div id="quick-colors" class="quick-colors"></div><section id="owned-materials" class="owned-materials"></section><label class="field-label">打印材质</label><div class="material-options">${MATERIALS.map((m) => `<button data-material="${m}">${labels[m]}</button>`).join('')}</div><p id="material-description" class="small-note"></p><label class="check-row"><input type="checkbox" id="same-source"> 同名零件一起调整</label><div class="part-actions"><button id="isolate" class="button subtle">${icon('eye')} 单独查看</button><button id="reset-part" class="button subtle">${icon('rotate-ccw')} 还原</button></div></div><hr><div class="section-heading">${icon('sun')} 灯光与表面</div><div class="segmented light-options"><button data-light="studio" class="active">摄影棚</button><button data-light="daylight">日光</button><button data-light="warm">暖光</button><button data-light="cinema">电影</button></div><div class="field-label pattern-heading">打光方式</div><div class="segmented light-options" id="pattern-row"><button data-pattern="standard">默认</button><button data-pattern="butterfly">蝴蝶光</button><button data-pattern="rembrandt">伦勃朗</button><button data-pattern="split">分割光</button><button data-pattern="rim">轮廓光</button></div><p id="light-description" class="small-note light-note"></p><label class="field-label" for="intensity">光源强度 <output id="intensity-value">100%</output></label><input id="intensity" type="range" min="30" max="180" value="100"><label class="field-label" for="direction">光源方向 <output id="direction-value">−35°</output></label><input id="direction" type="range" min="-180" max="180" value="-35"><label class="field-label" for="elevation">光源角度 <output id="elevation-value">51°</output></label><input id="elevation" type="range" min="5" max="85" value="51"><p class="small-note light-legend">调整光源时出现箭头，指向灯的位置：<b class="key-dot"></b>大箭头是主光，负责投影；<b class="fill-dot"></b>小箭头是补光与轮廓光，本身不投影。</p><label class="check-row"><input id="layers" type="checkbox" checked> 模拟 0.4 mm 打印层纹</label><p class="small-note">光泽与层纹为近似模拟，非耗材实测；层纹按装配竖直方向展示。</p><hr><div class="section-heading">${icon('layers')} 装配视图</div><label class="field-label" for="explode">零件展开 <output id="explode-value">0%</output></label><input id="explode" type="range" min="0" max="100" value="0"><label class="check-row"><input id="hardware" type="checkbox" checked> 显示舵机与电子零件</label><p class="small-note model-note">原版 XL330 步行装配，可切换轮滑模组。HD1910 改件尺寸不在此预览中。</p></div><button id="agent-info" class="agent-link">${icon('code')} Agent 接口与开放格式 ${icon('arrow-up-right')}</button></aside>
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
renderIcons();
installI18n();
const slogans = [
  '小鸭子，也有大脾气。',
  '今天这只鸭，有点不一样。',
  '出厂靠打印，出彩靠你。',
  '给机械一点叛逆。',
  '配色不撞款，小鸭不随大流。',
  '把灵感，涂成一只鸭。',
];
let sloganIndex = Math.floor(Math.random() * slogans.length);
$('#slogan').textContent = slogans[sloganIndex];
$('#shuffle-slogan').addEventListener('click', () => {
  sloganIndex =
    (sloganIndex + 1 + Math.floor(Math.random() * (slogans.length - 1))) % slogans.length;
  $('#slogan').textContent = slogans[sloganIndex];
});
let inventoryManager: ReturnType<typeof inventoryUI> | null = null;
let looksManager: ReturnType<typeof looksUI> | null = null;
let state: EditorState,
  viewer: Viewer,
  model: Manifest,
  selected: string | null = null,
  filter = 'printable',
  isolated = false,
  light = 'studio';
let toastTimer: ReturnType<typeof setTimeout>;
let motion: MotionName | 'sequence' = 'sequence';
/** Set when the stored palette could not be read, so autosave leaves those bytes alone. */
let unreadablePalette: string | null = null;
let loadBaseline = '';
let exploded = 0;
/** True while a module is being fitted: the parts are being re-registered, so nothing may move. */
let moduleBusy = false;
function toast(s: string) {
  $('#toast').textContent = s;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3500);
}
/**
 * Keep the controls that must not be used together in step. An action holds a pose over the
 * parts, so neither spreading them apart nor swapping the set under them may start while it
 * runs, and each of those two is out of reach while the other is already the case. Fitting a
 * module is a gate of its own: it re-registers every part in the model, so nothing else may
 * move until it has landed.
 */
function syncControls() {
  const toggle = $<HTMLButtonElement>('#motion-toggle');
  const playing = viewer.playing;
  toggle.classList.toggle('active', !!playing);
  toggle.disabled = exploded > 0 || moduleBusy;
  toggle.title = moduleBusy
    ? '模组载入中，请稍候'
    : exploded > 0
      ? '零件展开时不播放动作'
      : playing
        ? `停止动作（当前：${playing === 'sequence' ? '循环播放' : MOTION_LABELS[playing]}）`
        : '让它动起来';
  toggle.setAttribute('aria-label', toggle.title);
  // Spreading the parts while an action runs would pull them out from under the pose, so the
  // slider stays out of reach until the duck stops.
  const explode = $<HTMLInputElement>('#explode');
  const explodeLabel = document.querySelector<HTMLElement>('label[for="explode"]');
  explode.disabled = !!playing || moduleBusy;
  explodeLabel?.classList.toggle('disabled', !!playing || moduleBusy);
  if (explodeLabel)
    explodeLabel.title = playing ? '动作播放时不展开零件' : moduleBusy ? '模组载入中，请稍候' : '';
  // The module switch is the same bargain from the other side: it re-partitions the parts, and
  // an action is holding a pose over them. It also waits while they are spread apart, since the
  // set it would have to lay out on the floor is one of the ones currently off the rig.
  const moduleToggle = $<HTMLButtonElement>('#module-toggle');
  const blocked = playing ? '动作播放时不切换模组' : exploded > 0 ? '零件展开时不切换模组' : '';
  moduleToggle.disabled = moduleBusy || !!blocked;
  moduleToggle.title = blocked || '装上或拆下轮滑模组';
  document
    .querySelectorAll<HTMLElement>('[data-motion]')
    .forEach((b) => b.classList.toggle('active', motion === b.dataset.motion && !!playing));
}
function save() {
  if (isDemo) return;
  // A palette that failed to read is preserved until the user changes something themselves.
  if (unreadablePalette && JSON.stringify(state.palette) === loadBaseline) return;
  try {
    localStorage.setItem(`color-studio:${model.modelId}`, JSON.stringify(state.palette));
    $('#save-status').textContent = '已保存';
  } catch {
    $('#save-status').textContent = '自动保存不可用，请导出方案';
  }
}
function partRow(p: Manifest['parts'][number]) {
  const finish = state.palette.parts[p.id];
  return `<button class="part-row ${selected === p.id ? 'selected' : ''}" data-part="${p.id}" aria-pressed="${selected === p.id}"><span class="part-swatch" style="background:${finish.color}"></span><span>${escape(p.name)}</span>${finish.stockId ? '<small class="linked">联动</small>' : ''}${!p.printable ? '<small>硬件</small>' : ''}</button>`;
}
function assemblyGroups(parts: Manifest['parts']) {
  return [...new Set(parts.map((p) => p.assembly))]
    .map(
      (a) =>
        `<details open><summary>${escape(a)}<span>${parts.filter((p) => p.assembly === a).length}</span></summary>${parts
          .filter((p) => p.assembly === a)
          .map(partRow)
          .join('')}</details>`,
    )
    .join('');
}
function drawList() {
  const q = $<HTMLInputElement>('#search').value.trim().toLowerCase();
  const matches = (p: Manifest['parts'][number]) =>
    (filter === 'all' || p.printable) &&
    [p.name, t(p.name), p.id, p.assembly, t(p.assembly)].join(' ').toLowerCase().includes(q);
  const parts = model.parts.filter((p) => isFitted(p, module) && matches(p));
  // The other set is not on the duck, but it is part of the scheme: show it aside and dimmed
  // so the whole palette can be read and edited without wondering where those parts went.
  const aside = model.parts.filter((p) => !isFitted(p, module) && matches(p));
  $('#part-count').textContent = String(parts.length);
  $('#part-list').innerHTML =
    (parts.length ? assemblyGroups(parts) : '<div class="empty">没有找到匹配零件</div>') +
    (aside.length
      ? `<details open class="part-aside"><summary>${t('未安装')} · ${t(module === 'skate' ? '步行脚' : '轮滑模组')}<span>${aside.length}</span></summary>${assemblyGroups(aside)}</details>`
      : '');
}
function select(id: string) {
  if (!id) {
    clearSelection();
    return;
  }
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
/** Empty-space click: drop the highlight and the part editor, keep the look untouched. */
function clearSelection() {
  selected = null;
  viewer.select(null);
  syncInspector();
  drawList();
  window.dispatchEvent(new CustomEvent('colorstudio:selection', { detail: { id: null } }));
}
function renderOwned() {
  const host = $('#owned-materials');
  if (!host || !selected) return;
  const p = model.parts.find((x) => x.id === selected)!;
  const f = state.palette.parts[selected];
  const items = inventoryManager?.getInventory().items || [];
  const bound = items.find((x) => x.id === f.stockId);
  const linked = new Set(
    Object.values(state.palette.parts)
      .map((x) => x.stockId)
      .filter((x): x is string => !!x),
  );
  const compatible = items.filter((x) => (p.defaultMaterial === 'tpu') === (x.material === 'tpu'));
  host.innerHTML = `<div class="owned-heading"><span>我的已有耗材</span><button class="text-button" data-stock-manage>管理 ↗</button></div>${
    !p.printable
      ? '<p class="small-note">标准硬件不使用打印耗材。</p>'
      : !items.length
        ? '<p class="small-note">导入库存后，这里会单独展示已有的颜色和材质。</p>'
        : `<div class="stock-match ${bound ? 'in-stock' : 'not-stock'}">${
            bound
              ? `<span data-user-content>${escape(bound.name)}</span> · 已联动，素材库改色时此零件会跟着变<button class="text-button" data-unlink>解除</button>`
              : f.stockId
                ? '绑定的耗材已从素材库移除 · 已保留当前颜色'
                : '未联动素材 · 点选一卷耗材即可跟随它'
          }</div><div class="owned-chips">${compatible.map((i) => `<button data-owned="${i.id}" class="owned-chip ${f.stockId === i.id ? 'active' : ''}"><b style="background:${i.color}"></b><span><span data-user-content>${escape(i.name)}</span><small>${labels[i.material]}${linked.has(i.id) ? ' · 已联动' : ''}</small></span></button>`).join('') || '<p class="small-note">库存中没有适合此零件的材质。</p>'}</div><p class="small-note">联动后，在「我的耗材」里改这卷料的颜色或材质，零件会一起更新。</p>`
  }`;
  host.querySelector<HTMLElement>('[data-stock-manage]')!.onclick = () => inventoryManager?.open();
  const unlink = host.querySelector<HTMLElement>('[data-unlink]');
  if (unlink)
    unlink.onclick = () => {
      patch({ stockId: undefined });
      toast('已解除与素材库的联动');
    };
  host.querySelectorAll<HTMLElement>('[data-owned]').forEach(
    (b) =>
      (b.onclick = () => {
        const i = items.find((x) => x.id === b.dataset.owned)!;
        patch({ color: i.color, material: i.material, stockId: i.id });
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
  if (!selected) {
    $('#owned-materials').innerHTML = '';
    $('#selected-name').textContent = '选择一个零件';
    $('#selected-meta').textContent = '直接点击模型，或从左侧选择';
    $('#selected-meta').title = '';
    $('#selection-caption').textContent = '选中零件后，可在右侧单独调色';
    return;
  }
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
      : materialNotes[f.material];
}
function syncLighting() {
  const l = state.palette.lighting;
  const cinema = l.preset === 'cinema';
  light = l.preset;
  $<HTMLInputElement>('#intensity').value = String(l.intensity * 100);
  $<HTMLInputElement>('#direction').value = String(l.azimuth);
  $('#intensity-value').textContent = Math.round(l.intensity * 100) + '%';
  $('#direction-value').textContent = l.azimuth + '°';
  const elevation = l.elevation ?? defaultElevation(l.preset);
  $('#elevation-value').textContent = elevation + '°';
  $<HTMLInputElement>('#elevation').value = String(elevation);
  // The lamp setup belongs to the cinema stage; the other presets keep their own placement.
  $('#pattern-row').hidden = !cinema;
  document.querySelector<HTMLElement>('.pattern-heading')!.hidden = !cinema;
  $('#light-description').textContent = `${
    lightNotes[l.preset] || lightNotes.studio
  }${cinema && l.pattern ? patternNotes[l.pattern] : ''}`;
  $('#stage-mode-caption').textContent = stageCaptions[l.preset] || stageCaptions.studio;
  document.querySelector('.stage')?.classList.toggle('dark-stage', l.preset === 'cinema');
  $<HTMLInputElement>('#layers').checked = state.palette.surface.layers;
  document
    .querySelectorAll<HTMLElement>('[data-light]')
    .forEach((x) => x.classList.toggle('active', x.dataset.light === light));
  document
    .querySelectorAll<HTMLElement>('[data-pattern]')
    .forEach((x) => x.classList.toggle('active', x.dataset.pattern === (l.pattern || 'standard')));
  viewer.light(l);
}
/** Where the key lamp sits when the angle control has not been touched. */
function defaultElevation(preset: Lighting['preset']): number {
  const rig = LIGHT_RIGS[preset] || LIGHT_RIGS.studio;
  return Math.round((Math.atan2(rig.key.height, 420) * 180) / Math.PI);
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
  $('#looks-label').textContent = state.palette.name;
  if (!document.getElementById('looks-menu')?.hidden) looksManager?.refresh();
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
  const motionMenu = $('#motion-menu');
  let motionMenuTimer: ReturnType<typeof setTimeout> | undefined;
  const openMotionMenu = () => {
    clearTimeout(motionMenuTimer);
    if ($<HTMLButtonElement>('#motion-toggle').disabled) return;
    motionMenu.hidden = false;
    motionMenu.classList.remove('closing');
    $('#motion-toggle').setAttribute('aria-expanded', 'true');
  };
  // Closing waits a moment: the pointer crosses a gap on its way to the items.
  const closeMotionMenu = (immediately = false) => {
    clearTimeout(motionMenuTimer);
    const hide = () => {
      // Fade out first, then take it out of the layout.
      motionMenu.classList.add('closing');
      motionMenuTimer = setTimeout(() => {
        motionMenu.hidden = true;
        motionMenu.classList.remove('closing');
      }, 160);
      $('#motion-toggle').setAttribute('aria-expanded', 'false');
    };
    if (immediately) hide();
    else motionMenuTimer = setTimeout(hide, 260);
  };
  const playMotion = () => {
    // The menu is not a disabled control, so the gate on the button has to be said again here.
    if (exploded > 0) {
      toast('零件展开时不播放动作，收起后再试');
      return;
    }
    if (moduleBusy) {
      toast('模组载入中，请稍候');
      return;
    }
    viewer.play(motion);
    syncControls();
  };
  $('#motion-toggle').onclick = () => {
    if (viewer.playing) viewer.stopMotion();
    else playMotion();
    syncControls();
  };
  $('.motion-tools').addEventListener('mouseenter', openMotionMenu);
  $('.motion-tools').addEventListener('mouseleave', () => closeMotionMenu());
  motionMenu.addEventListener('mouseenter', openMotionMenu);
  motionMenu.addEventListener('mouseleave', () => closeMotionMenu());
  $('.motion-tools').addEventListener('focusin', openMotionMenu);
  $('.motion-tools').addEventListener('focusout', (event) => {
    if (!(event.relatedTarget as Element | null)?.closest?.('.motion-tools')) closeMotionMenu();
  });
  motionMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMotionMenu(true);
      $('#motion-toggle').focus();
    }
  });
  motionMenu.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-motion]');
    if (!button) return;
    motion = button.dataset.motion as MotionName | 'sequence';
    playMotion();
    closeMotionMenu(true);
    toast(motion === 'sequence' ? '循环播放全部动作' : `动作：${MOTION_LABELS[motion]}`);
  });
  syncControls();
  $('#fit').onclick = () => viewer.view('three-quarter');
  // Feet or skates: the last button on the view row fits the other set. The module is
  // geometry, so the first switch to skates fetches them.
  const moduleToggle = $<HTMLButtonElement>('#module-toggle');
  const syncModule = () => {
    moduleToggle.classList.toggle('active', module === 'skate');
    moduleToggle.setAttribute('aria-pressed', String(module === 'skate'));
    document.querySelectorAll<HTMLElement>('[data-motion]').forEach((b) => {
      const name = b.dataset.motion as MotionName | 'sequence';
      // Skating needs wheels under you; stepping needs a sole flat on the floor.
      b.hidden =
        module === 'skate'
          ? name === 'sequence' || GROUND_MOTIONS.includes(name as MotionName)
          : SKATE_MOTIONS.includes(name as MotionName);
    });
  };
  const fitModule = async (next: ModuleName) => {
    moduleBusy = true;
    syncControls();
    try {
      await viewer.setModule(next);
      module = next;
      if (!isDemo) localStorage.setItem(MODULE_KEY, module);
      syncModule();
      drawList();
      update();
      toast(module === 'skate' ? '已换上轮滑模组' : '已换回步行脚');
    } catch (error) {
      toast(`轮滑模组载入失败：${(error as Error).message}`);
    } finally {
      moduleBusy = false;
      syncControls();
    }
  };
  moduleToggle.onclick = () => void fitModule(module === 'skate' ? 'walk' : 'skate');
  module = readModule();
  // Fitting the stored module fetches its geometry, which is the same window a swap opens, so
  // it holds the stage still the same way rather than letting the first click race the load.
  moduleBusy = true;
  syncControls();
  void viewer.setModule(module).finally(() => {
    moduleBusy = false;
    syncModule();
    syncControls();
    drawList();
  });
  // Real fullscreen for the stage: the model gets the whole screen, tools included.
  const fullscreenButton = $<HTMLButtonElement>('#fullscreen');
  const stageElement = () => document.querySelector<HTMLElement>('.stage');
  // A recording runs headless, and a synthetic click is never granted the Fullscreen API.
  // Demo mode therefore puts the same styles on the stage directly: the picture is identical.
  const syncFullscreen = () => {
    const active =
      document.fullscreenElement === stageElement() ||
      !!stageElement()?.classList.contains('is-fullscreen');
    fullscreenButton.innerHTML = icon(active ? 'minimize' : 'maximize');
    renderIcons();
    fullscreenButton.title = active ? '退出全屏' : '全屏查看';
    fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
    fullscreenButton.setAttribute('aria-pressed', String(active));
  };
  // Hidden only where the call does not exist at all: browsers report `fullscreenEnabled` as
  // false in contexts that still honour a request, and a button that answers with a reason
  // beats one that quietly disappears.
  if (typeof stageElement()?.requestFullscreen !== 'function') fullscreenButton.hidden = true;
  fullscreenButton.onclick = () => {
    const stage = stageElement();
    if (!stage) return;
    if (isDemo) {
      stage.classList.toggle('is-fullscreen');
      syncFullscreen();
      return;
    }
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.requestFullscreen().catch(() => toast('此浏览器不支持全屏'));
  };
  document.addEventListener('fullscreenchange', syncFullscreen);
  syncFullscreen();
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
  document.querySelectorAll<HTMLInputElement>('[data-role-color]').forEach((e) => {
    const ids = () => model.parts.filter((p) => p.role === e.dataset.roleColor).map((p) => p.id);
    // Preview live while the picker is open; the palette is committed on release.
    e.oninput = () => {
      const temp = structuredClone(state.palette);
      for (const id of ids()) temp.parts[id].color = e.value;
      viewer.apply(temp, $<HTMLInputElement>('#layers').checked);
    };
    e.onchange = () => {
      state.update(ids(), { color: e.value });
      update();
    };
  });
  let lightHintTimer: ReturnType<typeof setTimeout> | undefined;
  const previewLighting = (showHint = false) => {
    const intensity = Number($<HTMLInputElement>('#intensity').value);
    const direction = Number($<HTMLInputElement>('#direction').value);
    const elevation = Number($<HTMLInputElement>('#elevation').value);
    $('#intensity-value').textContent = intensity + '%';
    $('#direction-value').textContent = direction + '°';
    $('#elevation-value').textContent = elevation + '°';
    viewer.light({
      ...state.palette.lighting,
      intensity: intensity / 100,
      azimuth: direction,
      elevation,
    });
    if (showHint) {
      // The arrow tracks the lamp while the slider moves and fades out shortly after.
      viewer.showLightHint(direction);
      clearTimeout(lightHintTimer);
      lightHintTimer = setTimeout(() => viewer.showLightHint(null), 700);
    }
  };
  document
    .querySelectorAll<HTMLElement>('[data-light]')
    .forEach(
      (e) => (e.onclick = () => setLighting({ preset: e.dataset.light as Lighting['preset'] })),
    );
  document.querySelectorAll<HTMLElement>('[data-pattern]').forEach(
    (e) =>
      (e.onclick = () =>
        setLighting({
          // "自带" clears the pattern so the preset's own lamp placement applies again.
          pattern:
            e.dataset.pattern === 'standard' ? undefined : (e.dataset.pattern as LightPattern),
        })),
  );
  $('#intensity').oninput = () => previewLighting();
  $('#direction').oninput = () => previewLighting(true);
  // Moving the angle is also aiming a lamp, so the arrows come out for it too.
  $('#elevation').oninput = () => previewLighting(true);
  $('#intensity').onchange = () =>
    setLighting({ intensity: Number($<HTMLInputElement>('#intensity').value) / 100 });
  $('#direction').onchange = () => {
    setLighting({ azimuth: Number($<HTMLInputElement>('#direction').value) });
    // Release: fade out on the spot instead of waiting for the idle timer.
    clearTimeout(lightHintTimer);
    viewer.showLightHint(null);
  };
  $('#elevation').onchange = () => {
    setLighting({ elevation: Number($<HTMLInputElement>('#elevation').value) });
    clearTimeout(lightHintTimer);
    viewer.showLightHint(null);
  };
  $('#layers').onchange = () => {
    const p = structuredClone(state.palette);
    p.surface.layers = $<HTMLInputElement>('#layers').checked;
    state.commit(p);
    update();
  };
  $('#explode').oninput = () => {
    const x = Number($<HTMLInputElement>('#explode').value);
    // Stop first, then spread: the pose reset re-applies the explode offset itself.
    if (x > 0) viewer.stopMotion();
    viewer.explode(x / 100);
    $('#explode-value').textContent = x + '%';
    exploded = x;
    syncControls();
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
    // Synthetic key events (automation, demo playback) can target document or window.
    if ((e.target as Element | null)?.matches?.('input,textarea')) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      e.shiftKey ? state.redo() : state.undo();
      update();
    }
  });
}
function showViewerFailure(error: Error) {
  let host = document.getElementById('loading');
  if (!host) {
    host = document.createElement('div');
    host.id = 'loading';
    $('#viewport').append(host);
  }
  host.innerHTML = `<strong>模型加载失败</strong><span>${mobilePreview() ? '此浏览器暂时无法预览 3D，请用电脑打开本页。' : '当前浏览器无法完成 3D 加载，请重试或更换浏览器。'}</span><button id="retry-model" class="button">重新加载</button><details><summary>错误详情</summary><span data-user-content>${escape(error.message)}</span></details>`;
  $('#retry-model').onclick = () => location.reload();
}
async function init() {
  try {
    const response = await fetch(
      new URL(manifestPath, new URL(import.meta.env.BASE_URL, location.href)),
    );
    if (!response.ok) throw new Error('无法读取模型清单');
    model = await response.json();
    state = new EditorState(model);
    let storedPalette: string | null = null;
    try {
      const stored = isDemo ? null : localStorage.getItem(`color-studio:${model.modelId}`);
      storedPalette = stored;
      if (stored) {
        const restored = repairPalette(JSON.parse(stored), model);
        if (!restored) throw new Error('无法识别的配色数据');
        state.palette = restored;
        for (const p of model.parts) {
          if (p.defaultColor === '#000000' && state.palette.parts[p.id].color === '#535960')
            state.palette.parts[p.id].color = '#000000';
        }
      }
    } catch {
      // Never let an unreadable value cost the user their work: keep the bytes, skip autosave.
      if (storedPalette) {
        unreadablePalette = storedPalette;
        try {
          localStorage.setItem(`color-studio:${model.modelId}:backup`, storedPalette);
        } catch {
          /* storage may be full or blocked; the in-memory copy still guards this session */
        }
        toast('之前的本地方案无法读取，已保留原始备份并恢复默认配色');
      }
    }
    loadBaseline = JSON.stringify(state.palette);
    looksManager = looksUI(
      model,
      () => state.palette,
      (p) => {
        state.commit(p);
        update();
      },
      toast,
      !isDemo,
    );
    $('#looks-toggle').onclick = () => looksManager!.toggle();
    viewer = new Viewer($('#viewport'), model, select, showViewerFailure);
    const base = new URL(manifestPath, new URL(import.meta.env.BASE_URL, location.href));
    // The roller module is fetched later, so it travels as a resolved URL too.
    if (model.rollerGeometryUrl)
      model.rollerGeometryUrl = new URL(model.rollerGeometryUrl, base).href;
    await viewer.load(
      new URL(
        mobilePreview() && model.mobileGeometryUrl ? model.mobileGeometryUrl : model.geometryUrl,
        base,
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
    // Editing a filament in "my filaments" pushes its color and material onto every linked part.
    window.addEventListener('colorstudio:inventory', () => {
      const changed = state.syncStock(stock.getInventory().items);
      update();
      if (changed.length) toast(`已按素材库更新 ${changed.length} 个联动零件`);
    });
    $('#inventory-open').onclick = stock.open;
    $('#recommend-open').onclick = stock.open;
    let printManager: Promise<ReturnType<typeof import('./print-ui').printUI>> | null = null;
    const printing = () =>
      (printManager ||= import('./print-ui').then(({ printUI }) =>
        printUI(model, () => state.palette),
      ));
    const closeExportMenu = () => {
      $('#export-menu').hidden = true;
      $('#export-menu-toggle').setAttribute('aria-expanded', 'false');
    };
    $('#export-menu-toggle').onclick = () => {
      const menu = $('#export-menu');
      menu.hidden = !menu.hidden;
      $('#export-menu-toggle').setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) $('#export-print-open').focus();
    };
    document.addEventListener('click', (event) => {
      if (!(event.target as Element).closest('.export-split')) closeExportMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('#export-menu').hidden) {
        closeExportMenu();
        $('#export-menu-toggle').focus();
      }
    });
    $('#export-print-open').onclick = () => {
      closeExportMenu();
      void printing()
        .then((p) => p.open())
        .catch((e) => toast(e.message));
    };
    const api: ColorStudioAPI = {
      version: 1,
      importPrintModel: async (bytes, name) => (await printing()).load(bytes, name),
      getPrintSetup: async () => (await printing()).getSetup(),
      getPrintMatches: async () => (await printing()).matches(),
      configurePrint: async (assignments, options) =>
        (await printing()).configure(assignments, options),
      planPrint: async () => (await printing()).plan(),
      exportPrint: async () => (await printing()).export(),
      getInventory: stock.getInventory,
      setInventory: stock.setInventory,
      recommend: stock.recommend,
      getLooks: () => looksManager!.list(),
      saveLook: (name: string) => {
        looksManager!.save(name);
        return looksManager!.list();
      },
      applyLook: (id: string) => looksManager!.apply(id),
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
      playMotion: (name: MotionName | 'sequence' | null) => {
        if (name === null || exploded > 0) viewer.stopMotion();
        else {
          motion = name;
          viewer.play(name);
        }
        syncControls();
        return viewer.playing;
      },
      setView: (name: string) => viewer.view(name),
      getRig: () => viewer.rig(),
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
        {
          load: async (bytes, name) => (await printing()).load(bytes, name),
        },
      );
    }
  } catch (error) {
    showViewerFailure(error instanceof Error ? error : new Error(String(error)));
    console.error(error);
  }
}
init();
