import type { Manifest } from './domain';
import type { PrintProject } from './print-project';

/** A model adapter owns the bindings; generic printing never matches model-specific names. */
export type PrintSample = {
  id: string;
  name: string;
  label: string;
  modelId: string;
  url: string;
  /** Start from the manufacturing file's finishes, with palette links available on demand. */
  useSourceFinish?: boolean;
  bindings: Record<string, { name: string; partId: string | null }>;
};

/** Verify the whole sample before the worker commits it. Names guard against renumbered files. */
export function applyPrintSample(
  project: PrintProject,
  model: Manifest,
  sample: Omit<PrintSample, 'url'>,
): PrintProject {
  if (model.modelId !== sample.modelId)
    throw new Error('Sample model does not match this model pack.');
  const ids = new Set(project.objects.map((o) => o.sourceObjectId));
  if (
    ids.size !== project.objects.length ||
    ids.size !== Object.keys(sample.bindings).length ||
    Object.keys(sample.bindings).some((id) => !ids.has(id))
  )
    throw new Error('Sample geometry does not match its part bindings.');
  const objects = project.objects.map((object) => {
    const binding = sample.bindings[object.sourceObjectId!];
    if (binding.name !== object.name)
      throw new Error('Sample geometry does not match its part bindings.');
    if (binding.partId && !model.parts.some((p) => p.id === binding.partId && p.printable))
      throw new Error('Unknown sample part binding.');
    return {
      ...object,
      matches: binding.partId ? [{ partId: binding.partId, confidence: 1, ambiguous: false }] : [],
    };
  });
  return { ...project, objects, sampleId: sample.id };
}
