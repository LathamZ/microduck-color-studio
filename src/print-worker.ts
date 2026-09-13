import {
  readPrintProject,
  planPrint,
  exportPrintPackage,
  type PrintProject,
} from './print-project';
let project: PrintProject | null = null;
self.onmessage = (event: MessageEvent) => {
  const { id, type, payload } = event.data;
  try {
    if (type === 'load') {
      const next = readPrintProject(payload.bytes, payload.name, payload.model);
      project = next;
      self.postMessage({
        id,
        result: {
          name: next.name,
          objects: next.objects.map(({ vertices, triangles, ...object }) => ({
            ...object,
            triangles: triangles.length,
          })),
        },
      });
    } else {
      if (!project) throw new Error('Upload a print model first.');
      const plan = planPrint(project, payload.palette, payload.assignments, payload.options);
      if (type === 'plan') self.postMessage({ id, result: plan });
      else if (type === 'export') {
        const result = exportPrintPackage(project, plan);
        self.postMessage({ id, result }, { transfer: [result.buffer] });
      } else throw new Error('Unknown print operation.');
    }
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
