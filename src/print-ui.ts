import { PRINTERS, printerById } from './printers';
import { MATERIAL_LABELS, MATERIALS, type Manifest, type Palette, type Finish } from './domain';
import { t } from './i18n';
import {
  MATCH_ACCEPT,
  MATCH_FLOOR,
  matchAction,
  type PrintAssignment,
  type PrintObject,
  type PrintOptions,
  type PrintPlan,
} from './print-project';
export type PrintSummary = { name: string; objects: Omit<PrintObject, 'vertices' | 'triangles'>[] };
export type PrintSetup = {
  source: PrintSummary | null;
  assignments: PrintAssignment[];
  options: PrintOptions;
};
export type PrintMatchState = {
  objectId: string;
  name: string;
  partId?: string;
  confidence: number | null;
  /** Unmatched below the confidence floor: export waits for a human decision. */
  needsConfirm: boolean;
};
export type PrintAPI = {
  load(bytes: Uint8Array, name: string): Promise<PrintSetup>;
  getSetup(): PrintSetup;
  matches(): PrintMatchState[];
  configure(assignments: PrintAssignment[], options: PrintOptions): Promise<PrintPlan>;
  plan(): Promise<PrintPlan>;
  export(): Promise<Uint8Array>;
};
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
/** Bare number: every call site writes its own % so the sign can be translated. */
const percent = (confidence: number) => String(Math.round(confidence * 100));
export function printUI(model: Manifest, getPalette: () => Palette): PrintAPI & { open(): void } {
  let worker: Worker | null = null,
    seq = 0,
    source: PrintSummary | null = null,
    assignments: PrintAssignment[] = [];
  let options: PrintOptions = {
    width: 256,
    depth: 256,
    height: 256,
    margin: 10,
    gap: 8,
    grouping: 'color',
  };
  let selectedPrinter = '';
  /** Objects whose part link the user chose by hand; those never need re-confirming. */
  const manualChoices = new Set<string>();
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  function request<T>(type: string, payload: unknown): Promise<T> {
    if (!worker) {
      worker = new Worker(new URL('./print-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const p = pending.get(data.id);
        if (!p) return;
        pending.delete(data.id);
        if (data.error) p.reject(new Error(data.error));
        else p.resolve(data.result);
      };
      worker.onerror = () => {
        for (const p of pending.values())
          p.reject(new Error('Print worker failed. Please reopen the page.'));
        pending.clear();
        worker?.terminate();
        worker = null;
        source = null;
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker!.postMessage({ id, type, payload });
    });
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'print-dialog';
  dialog.setAttribute('aria-labelledby', 'print-title');
  dialog.innerHTML = `<div class="panel-title"><div><span class="eyebrow">FROM LOOK TO PRINT</span><h2 id="print-title">导出 3D 打印模型</h2></div><button class="icon-button" id="print-close" aria-label="关闭">×</button></div><p class="small-note">上传实际打印用的 3MF（如 HD1910 版本），再关联当前配色。展示模型保持不变。文件仅在浏览器本地处理。</p><div class="print-upload"><label class="button" for="print-source">上传打印模型 .3mf</label><input type="file" id="print-source" accept=".3mf" hidden><span id="print-source-name" data-user-content>—</span></div><p id="print-status" role="status" class="small-note"></p><div id="print-controls" hidden><label class="printer-picker">打印机型号<select id="print-printer"><option value="">请选择打印机</option>${PRINTERS.map((p) => `<option value="${p.id}">${p.name} · ${p.width} × ${p.depth} mm</option>`).join('')}<option value="custom">自定义打印盘</option></select></label><p class="small-note">机型只用于底板尺寸和多盘位置对齐。请在切片软件确认实际喷嘴、耗材和打印工艺。双喷嘴机型保守使用共同可达区域排盘。</p><div class="print-dimensions"><label>打印盘宽度 mm<input id="print-width" type="number" min="20" max="2000" value="256"></label><label>打印盘深度 mm<input id="print-depth" type="number" min="20" max="2000" value="256"></label><label>可用高度 mm<input id="print-height" type="number" min="1" max="2000" value="256"></label><label>边距 mm<input id="print-margin" type="number" min="0" value="10"></label><label>零件间距 mm<input id="print-gap" type="number" min="0" value="8"></label><label>分盘方式<select id="print-grouping"><option value="color">相同材质与颜色同盘</option><option value="part">部件、材质与颜色分盘</option></select></label></div><p class="small-note">保留源模型的打印朝向与尺寸。请按打印机设置可用区域，并为裙边和支撑留空间。</p><div class="print-toolbar"><h3>关联配色</h3><span>零件名会按相似度自动匹配；未匹配的零件按源文件颜色导出。</span></div><div id="print-object-list" class="print-object-list"></div><div id="print-match-warning" class="print-match-warning" hidden><b aria-hidden="true">*</b><div><p id="print-match-warning-text"></p></div></div><div class="print-actions"><button id="print-plan" class="button subtle">预览分盘</button><button id="print-download" class="button primary">下载打印包</button></div><div id="print-plan-preview" class="print-plan-preview"></div><p class="small-note">一个 3MF 项目保留所有盘的颜色和排布，附逐件 STL 与 JSON 清单。切片工艺、支撑涂色和 G-code 不随包导出；请在切片软件中重新设置。丙烯涂色记为后处理，按底材颜色分盘。</p></div>`;
  document.body.append(dialog);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => dialog.querySelector<T>(s)!;
  const status = (s: string, error = false) => {
    $('#print-status').textContent = s;
    $('#print-status').classList.toggle('error', error);
  };
  let busy = false;
  async function operation(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    dialog.setAttribute('aria-busy', 'true');
    for (const e of dialog.querySelectorAll<HTMLButtonElement>('button:not(#print-close)'))
      e.disabled = true;
    try {
      await action();
    } catch (e) {
      status(e instanceof Error ? e.message : String(e), true);
    } finally {
      busy = false;
      dialog.removeAttribute('aria-busy');
      for (const e of dialog.querySelectorAll<HTMLButtonElement>('button')) e.disabled = false;
      syncGate();
    }
  }
  const partOf = (id: string) => model.parts.find((p) => p.id === id);
  const rowFor = (objectId: string) =>
    dialog.querySelector<HTMLElement>(`[data-print-object="${objectId}"]`);
  /** One row per build object: its assignment, its best candidate and whether a human must look. */
  function rows() {
    if (!source) return [];
    return source.objects.map((obj) => {
      const assignment = assignments.find((a) => a.objectId === obj.id)!;
      const best = obj.matches[0];
      const confidence = best ? best.confidence : null;
      // Two parts named the same: there is no single best answer to apply on the user's behalf.
      const tied =
        confidence !== null &&
        !!obj.matches[1] &&
        Math.abs(obj.matches[1].confidence - confidence) < 1e-9;
      const chosen = manualChoices.has(obj.id);
      const action = matchAction(confidence, {
        linked: !!assignment.partId,
        chosen,
        // A near-tie is as unsafe as a low score: the user should still confirm the pick.
        contested: tied || !!best?.ambiguous,
      });
      return {
        obj,
        assignment,
        best,
        confidence,
        tied,
        chosen,
        mustPick: action === 'choose',
        needsConfirm: action !== 'auto',
      };
    });
  }
  const unresolved = () => rows().filter((r) => r.needsConfirm);
  /** Only rows that need nothing get a hint; everything else is summed up in the banner. */
  function hintFor(row: ReturnType<typeof rows>[number]) {
    const { assignment, confidence, chosen } = row;
    if (!assignment.partId) return '';
    if (chosen) return '已手动选择这个零件，导出时使用它的配色';
    if (confidence === null) return '已手动关联，导出时使用此零件的配色';
    return `已按零件名自动匹配 · 可信度 ${percent(confidence)}%`;
  }
  function optionList(
    obj: Pick<PrintObject, 'matches'>,
    selected: string | undefined,
    needsPick: boolean,
  ) {
    const ranked = obj.matches.map((m) => ({
      part: partOf(m.partId)!,
      label: `${percent(m.confidence)}%`,
    }));
    const rest = model.parts.filter(
      (p) => p.printable && !obj.matches.some((m) => m.partId === p.id),
    );
    const entry = (part: NonNullable<ReturnType<typeof partOf>>, label?: string) =>
      `<option value="${part.id}" ${selected === part.id ? 'selected' : ''}>${label ? label + ' · ' : ''}${esc(t(part.name))} · ${part.id}</option>`;
    // Below the floor nothing is preselected: picking a part is the confirmation.
    const head = needsPick
      ? '<option value="" disabled selected>请选择零件…</option>'
      : `<option value="" ${selected ? '' : 'selected'}>独立配色</option>`;
    return `${head}<option value="">独立配色</option>${ranked
      .map((r) => entry(r.part, r.label))
      .join('')}${rest.map((p) => entry(p)).join('')}`;
  }
  /** Rows worth telling the user about: no match, or a match weak enough to double-check. */
  const unmatched = () => unresolved().filter((r) => r.mustPick);
  const unverified = () => unresolved().filter((r) => !r.mustPick);
  function syncGate() {
    const list = unresolved();
    const picked = unmatched();
    const weak = unverified();
    $('#print-match-warning').hidden = !list.length;
    if (list.length) {
      const reasons = [
        picked.length ? `${picked.length} 个零件未匹配到配色，将保持源文件颜色导出。` : '',
        weak.length ? `${weak.length} 个零件匹配度低于 80%，已选最相近的零件，请核对。` : '',
      ]
        .filter(Boolean)
        .join('');
      const names = list
        .slice(0, 3)
        .map((r) => r.obj.name)
        .join('、');
      $('#print-match-warning-text').textContent =
        `${list.length} 个零件需要留意：${reasons}例如 ${names}${list.length > 3 ? ' 等' : ''}你可以在下方手动关联，不改也能直接导出。`;
    }
  }
  function render() {
    $('#print-controls').hidden = !source;
    $<HTMLSelectElement>('#print-printer').value = selectedPrinter;
    for (const k of ['width', 'depth', 'height'])
      $<HTMLInputElement>('#print-' + k).disabled = selectedPrinter !== 'custom';
    $('#print-source-name').textContent = source?.name || '—';
    if (!source) return;
    const palette = getPalette();
    $('#print-object-list').innerHTML = rows()
      .map((row) => {
        const { obj, assignment, needsConfirm, mustPick } = row;
        const finish = (assignment.partId ? palette.parts[assignment.partId] : assignment.finish)!;
        return `<div class="print-object ${needsConfirm ? (mustPick ? 'needs-review' : 'needs-check') : ''}" data-print-object="${obj.id}"><label class="print-object-name"><input type="checkbox" data-setting="enabled" ${assignment.enabled ? 'checked' : ''}><span data-user-content>${esc(obj.name)}<small>${obj.size.map((n) => n.toFixed(1)).join(' × ')} mm</small></span></label><div><select data-setting="partId" aria-label="关联配色部件">${optionList(obj, assignment.partId, mustPick)}</select>${needsConfirm ? '' : `<small>${esc(hintFor(row))}</small>`}</div><div class="print-finish"><input type="color" data-setting="color" value="${finish.color}" aria-label="打印颜色" ${assignment.partId ? 'disabled' : ''}><select data-setting="material" aria-label="打印材质" ${assignment.partId ? 'disabled' : ''}>${MATERIALS.map((m) => `<option value="${m}" ${finish.material === m ? 'selected' : ''}>${MATERIAL_LABELS[m]}</option>`).join('')}</select></div></div>`;
      })
      .join('');
    for (const key of ['width', 'depth', 'height', 'margin', 'gap', 'grouping'] as const)
      $<HTMLInputElement>('#print-' + key).value = String(options[key]);
    syncGate();
  }
  const payload = () => {
    if (!selectedPrinter) throw new Error(t('请选择打印机'));
    return { palette: getPalette(), assignments, options };
  };
  const api: PrintAPI & { open(): void } = {
    async load(bytes, name) {
      const next = await request<PrintSummary>('load', { bytes, name, model });
      source = next;
      assignments = next.objects.map((o) => {
        const best = o.matches[0];
        // Always take the best candidate; only names below the floor stay for a human to resolve.
        return {
          objectId: o.id,
          enabled: o.printable,
          ...(best && best.confidence >= MATCH_FLOOR
            ? { partId: best.partId }
            : { finish: { color: o.originalColor, material: o.originalMaterial } }),
        };
      });
      manualChoices.clear();
      render();
      clearPreview();
      return api.getSetup();
    },
    getSetup() {
      return structuredClone({ source, assignments, options });
    },
    matches() {
      return rows().map((r) => ({
        objectId: r.obj.id,
        name: r.obj.name,
        partId: r.assignment.partId,
        confidence: r.confidence,
        needsConfirm: r.needsConfirm,
      }));
    },
    async configure(nextAssignments, nextOptions) {
      const plan = await request<PrintPlan>('plan', {
        palette: getPalette(),
        assignments: nextAssignments,
        options: nextOptions,
      });
      assignments = structuredClone(nextAssignments);
      options = structuredClone(nextOptions);
      selectedPrinter = nextOptions.printerId || 'custom';
      render();
      return plan;
    },
    plan() {
      return request<PrintPlan>('plan', payload());
    },
    export() {
      return request<Uint8Array>('export', payload());
    },
    open() {
      render();
      dialog.showModal();
    },
  };
  $('#print-close').onclick = () => dialog.close();
  $('#print-printer').onchange = () => {
    selectedPrinter = $<HTMLSelectElement>('#print-printer').value;
    const printer = printerById(selectedPrinter);
    options.printerId = selectedPrinter || undefined;
    if (printer) {
      options.width = printer.width;
      options.depth = printer.depth;
      options.height = printer.height;
    }
    clearPreview();
    render();
  };
  $<HTMLInputElement>('#print-source').onchange = (event) => {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    void operation(async () => {
      status('正在读取打印模型…');
      if (file.size > 100 * 1024 * 1024) throw new Error('3MF exceeds the 100 MB import limit.');
      await api.load(new Uint8Array(await file.arrayBuffer()), file.name);
      status('模型已载入，请核对零件关联和打印材质。');
    });
    input.value = '';
  };
  $('#print-object-list').onchange = (event) => {
    const input = event.target as HTMLInputElement,
      row = input.closest<HTMLElement>('[data-print-object]');
    if (!row) return;
    const a = assignments.find((a) => a.objectId === row.dataset.printObject)!;
    if (input.dataset.setting === 'enabled') a.enabled = input.checked;
    if (input.dataset.setting === 'partId') {
      // A deliberate choice settles this row, including "independent finish".
      manualChoices.add(a.objectId);
      if (input.value) {
        a.partId = input.value;
        delete a.finish;
      } else {
        const seed = a.partId ? getPalette().parts[a.partId] : a.finish;
        a.finish = structuredClone(seed || { color: '#F1EFE7', material: 'pla' });
        delete a.partId;
      }
    }
    if (input.dataset.setting === 'color' && a.finish) a.finish.color = input.value;
    if (input.dataset.setting === 'material' && a.finish)
      a.finish.material = input.value as Finish['material'];
    clearPreview();
    render();
  };
  for (const key of ['width', 'depth', 'height', 'margin', 'gap', 'grouping'] as const)
    $('#print-' + key).onchange = () => {
      const value = $<HTMLInputElement>('#print-' + key).value;
      if (key === 'grouping') options.grouping = value as PrintOptions['grouping'];
      else options[key] = Number(value);
      clearPreview();
    };
  function preview(plan: PrintPlan) {
    $('#print-plan-preview').innerHTML = plan.plates
      .map(
        (p) =>
          `<section class="print-plate"><h4><i style="background:${p.color}"></i><span>${p.id} · ${MATERIAL_LABELS[p.material]} · ${p.color}</span></h4><svg role="img" aria-label="分盘俯视图" viewBox="0 0 ${plan.options.width} ${plan.options.depth}"><rect width="100%" height="100%" fill="#edf0ea"/>${p.placements.map((o, i) => `<g><title data-user-content>${esc(o.name)}</title><rect x="${o.x}" y="${plan.options.depth - o.y - o.size[1]}" width="${o.size[0]}" height="${o.size[1]}" fill="${p.color}" stroke="#44584e" stroke-width=".7"/><text x="${o.x + o.size[0] / 2}" y="${plan.options.depth - o.y - o.size[1] / 2}" text-anchor="middle" font-size="7" fill="#13251c" stroke="white" stroke-width=".3" paint-order="stroke">${i + 1}</text></g>`).join('')}</svg><ol>${p.placements.map((o) => `<li data-user-content>${esc(o.name)}</li>`).join('')}</ol></section>`,
      )
      .join('');
  }
  const clearPreview = () => {
    clearPreview();
    $('#print-plan').textContent = t('预览分盘');
  };
  $('#print-plan').onclick = () =>
    void operation(async () => {
      // The button is a toggle: the same click that opened the plates puts them away.
      if ($('#print-plan-preview').innerHTML.trim()) {
        clearPreview();
        status('已收起分盘预览。');
        return;
      }
      status('正在计算分盘…');
      const plan = await api.plan();
      preview(plan);
      $('#print-plan').textContent = t('收起预览');
      $('#print-plan-preview').scrollIntoView({ block: 'nearest' });
      status('分盘完成。下图为零件占用范围，请在切片软件中检查支撑。');
    });
  $('#print-download').onclick = () =>
    void operation(async () => {
      status('正在生成打印包…');
      const bytes = await api.export();
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: 'application/zip' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'microduck-print-package.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status('打印包已下载。');
    });
  return api;
}
