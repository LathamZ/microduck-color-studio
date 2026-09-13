import { PRINTERS, printerById } from './printers';
import { MATERIALS, type Manifest, type Palette, type Finish } from './domain';
import { t } from './i18n';
import type { PrintAssignment, PrintOptions, PrintPlan, PrintObject } from './print-project';
export type PrintSummary = { name: string; objects: Omit<PrintObject, 'vertices' | 'triangles'>[] };
export type PrintSetup = {
  source: PrintSummary | null;
  assignments: PrintAssignment[];
  options: PrintOptions;
};
export type PrintAPI = {
  load(bytes: Uint8Array, name: string): Promise<PrintSetup>;
  getSetup(): PrintSetup;
  configure(assignments: PrintAssignment[], options: PrintOptions): Promise<PrintPlan>;
  plan(): Promise<PrintPlan>;
  export(): Promise<Uint8Array>;
};
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const materialNames: Record<Finish['material'], string> = {
  pla: 'PLA',
  'matte-pla': '哑光 PLA',
  petg: 'PETG',
  'matte-petg': '哑光 PETG',
  'metallic-petg': '金属质感 PETG',
  'pla-cf': 'PLA-CF',
  tpu: 'TPU',
};
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
  dialog.innerHTML = `<div class="panel-title"><div><span class="eyebrow">FROM LOOK TO PRINT</span><h2 id="print-title">导出 3D 打印模型</h2></div><button class="icon-button" id="print-close" aria-label="关闭">×</button></div><p class="small-note">上传实际打印用的 3MF（如 HD1910 版本），再关联当前配色。展示模型保持不变。文件仅在浏览器本地处理。</p><div class="print-upload"><label class="button" for="print-source">上传打印模型 .3mf</label><input type="file" id="print-source" accept=".3mf" hidden><span id="print-source-name" data-user-content>—</span></div><p id="print-status" role="status" class="small-note"></p><div id="print-controls" hidden><label class="printer-picker">打印机型号<select id="print-printer"><option value="">请选择打印机</option>${PRINTERS.map((p) => `<option value="${p.id}">${p.name} · ${p.width} × ${p.depth} mm</option>`).join('')}<option value="custom">自定义打印盘</option></select></label><p class="small-note">机型只用于底板尺寸和多盘位置对齐。请在切片软件确认实际喷嘴、耗材和打印工艺。双喷嘴机型保守使用共同可达区域排盘。</p><div class="print-dimensions"><label>打印盘宽度 mm<input id="print-width" type="number" min="20" max="2000" value="256"></label><label>打印盘深度 mm<input id="print-depth" type="number" min="20" max="2000" value="256"></label><label>可用高度 mm<input id="print-height" type="number" min="1" max="2000" value="256"></label><label>边距 mm<input id="print-margin" type="number" min="0" value="10"></label><label>零件间距 mm<input id="print-gap" type="number" min="0" value="8"></label><label>分盘方式<select id="print-grouping"><option value="color">相同材质与颜色同盘</option><option value="part">部件、材质与颜色分盘</option></select></label></div><p class="small-note">保留源模型的打印朝向与尺寸。请按打印机设置可用区域，并为裙边和支撑留空间。</p><div class="print-toolbar"><h3>关联配色</h3><span>未匹配的零件可独立选色；不需要的零件取消勾选。</span></div><div id="print-object-list" class="print-object-list"></div><div class="print-actions"><button id="print-plan" class="button subtle">预览分盘</button><button id="print-download" class="button primary">下载打印包</button></div><div id="print-plan-preview" class="print-plan-preview"></div><p class="small-note">一个 3MF 项目保留所有盘的颜色和排布，附逐件 STL 与 JSON 清单。切片工艺、支撑涂色和 G-code 不随包导出；请在切片软件中重新设置。丙烯涂色记为后处理，按底材颜色分盘。</p></div>`;
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
    $('#print-object-list').innerHTML = source.objects
      .map((obj) => {
        const a = assignments.find((a) => a.objectId === obj.id)!;
        const f = (a.partId ? palette.parts[a.partId] : a.finish)!;
        return `<div class="print-object" data-print-object="${obj.id}"><label class="print-object-name"><input type="checkbox" data-setting="enabled" ${a.enabled ? 'checked' : ''}><span data-user-content>${esc(obj.name)}<small>${obj.size.map((n) => n.toFixed(1)).join(' × ')} mm</small></span></label><div><select data-setting="partId" aria-label="关联配色部件"><option value="">独立配色</option>${model.parts
          .filter((p) => p.printable)
          .map(
            (p) =>
              `<option value="${p.id}" ${a.partId === p.id ? 'selected' : ''}>${esc(t(p.name))} · ${p.id}</option>`,
          )
          .join(
            '',
          )}</select><small>${obj.suggestedPartIds.length === 1 ? '已按源零件名关联，请核对' : obj.suggestedPartIds.length > 1 ? '有多个候选，请选择对应部件' : '未匹配，请独立设置或关联部件'}</small></div><div class="print-finish"><input type="color" data-setting="color" value="${f.color}" aria-label="打印颜色" ${a.partId ? 'disabled' : ''}><select data-setting="material" aria-label="打印材质" ${a.partId ? 'disabled' : ''}>${MATERIALS.map((m) => `<option value="${m}" ${f.material === m ? 'selected' : ''}>${materialNames[m]}</option>`).join('')}</select></div></div>`;
      })
      .join('');
    for (const key of ['width', 'depth', 'height', 'margin', 'gap', 'grouping'] as const)
      $<HTMLInputElement>('#print-' + key).value = String(options[key]);
  }
  const payload = () => {
    if (!selectedPrinter) throw new Error(t('请选择打印机'));
    return { palette: getPalette(), assignments, options };
  };
  const api: PrintAPI & { open(): void } = {
    async load(bytes, name) {
      const next = await request<PrintSummary>('load', { bytes, name, model });
      source = next;
      assignments = next.objects.map((o) => ({
        objectId: o.id,
        enabled: o.printable,
        ...(o.suggestedPartIds.length === 1
          ? { partId: o.suggestedPartIds[0] }
          : { finish: { color: o.originalColor, material: o.originalMaterial } }),
      }));
      render();
      $('#print-plan-preview').innerHTML = '';
      return api.getSetup();
    },
    getSetup() {
      return structuredClone({ source, assignments, options });
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
    $('#print-plan-preview').innerHTML = '';
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
      if (input.value) {
        a.partId = input.value;
        delete a.finish;
      } else {
        a.finish = structuredClone(
          getPalette().parts[a.partId!] || { color: '#F1EFE7', material: 'pla' },
        );
        delete a.partId;
      }
    }
    if (input.dataset.setting === 'color' && a.finish) a.finish.color = input.value;
    if (input.dataset.setting === 'material' && a.finish)
      a.finish.material = input.value as Finish['material'];
    $('#print-plan-preview').innerHTML = '';
    render();
  };
  for (const key of ['width', 'depth', 'height', 'margin', 'gap', 'grouping'] as const)
    $('#print-' + key).onchange = () => {
      const value = $<HTMLInputElement>('#print-' + key).value;
      if (key === 'grouping') options.grouping = value as PrintOptions['grouping'];
      else options[key] = Number(value);
      $('#print-plan-preview').innerHTML = '';
    };
  function preview(plan: PrintPlan) {
    $('#print-plan-preview').innerHTML = plan.plates
      .map(
        (p) =>
          `<section class="print-plate"><h4><i style="background:${p.color}"></i><span>${p.id} · ${materialNames[p.material]} · ${p.color}</span></h4><svg role="img" aria-label="分盘俯视图" viewBox="0 0 ${plan.options.width} ${plan.options.depth}"><rect width="100%" height="100%" fill="#edf0ea"/>${p.placements.map((o, i) => `<g><title data-user-content>${esc(o.name)}</title><rect x="${o.x}" y="${plan.options.depth - o.y - o.size[1]}" width="${o.size[0]}" height="${o.size[1]}" fill="${p.color}" stroke="#44584e" stroke-width=".7"/><text x="${o.x + o.size[0] / 2}" y="${plan.options.depth - o.y - o.size[1] / 2}" text-anchor="middle" font-size="7" fill="#13251c" stroke="white" stroke-width=".3" paint-order="stroke">${i + 1}</text></g>`).join('')}</svg><ol>${p.placements.map((o) => `<li data-user-content>${esc(o.name)}</li>`).join('')}</ol></section>`,
      )
      .join('');
  }
  $('#print-plan').onclick = () =>
    void operation(async () => {
      status('正在计算分盘…');
      const plan = await api.plan();
      preview(plan);
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
