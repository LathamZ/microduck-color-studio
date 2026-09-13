#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaults,
  validatePalette,
  EditorState,
  type Manifest,
  type Palette,
  type Lighting,
} from '../src/domain.ts';
import { recommend, validateInventory, type RecommendationMode } from '../src/recommend.ts';
import { presets } from '../src/models/active.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args.shift();
const flag = (name: string) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? undefined : args[i + 1];
};
const read = (p: string) => JSON.parse(readFileSync(resolve(p), 'utf8'));
const model = read(flag('model') || resolve(root, 'public/models/parts.json')) as Manifest;
const required = (name: string) => {
  const v = flag(name);
  if (!v || v.startsWith('--')) throw new Error(`Missing --${name}`);
  return v;
};
const output = (data: unknown) => {
  const json = JSON.stringify(data, null, 2) + '\n';
  const out = flag('out');
  if (out) writeFileSync(resolve(out), json, { flag: 'wx' });
  else process.stdout.write(json);
};
try {
  switch (command) {
    case 'recommend': {
      const inventory = validateInventory(read(required('inventory')));
      const base = flag('in') ? validatePalette(read(required('in')), model) : defaults(model);
      output(
        recommend(model, base, inventory, presets, (flag('mode') || 'stock') as RecommendationMode),
      );
      break;
    }
    case 'inventory-validate':
      output({ valid: !!validateInventory(read(required('in'))) });
      break;
    case 'parts':
      output(model.parts.filter((p) => !flag('role') || p.role === flag('role')));
      break;
    case 'new':
      output(defaults(model));
      break;
    case 'validate': {
      const p = validatePalette(read(required('in')), model);
      output({ valid: true, modelId: p.modelId, parts: Object.keys(p.parts).length });
      break;
    }
    case 'edit': {
      const s = new EditorState(model);
      s.palette = validatePalette(read(required('in')), model);
      const changes = read(required('patch')) as {
        parts?: Palette['parts'];
        lighting?: Partial<Lighting>;
        surface?: Palette['surface'];
        name?: string;
      };
      const p = structuredClone(s.palette);
      if (changes.parts)
        for (const [id, patch] of Object.entries(changes.parts)) {
          if (!p.parts[id]) throw new Error(`Unknown part: ${id}`);
          p.parts[id] = { ...p.parts[id], ...patch };
        }
      if (changes.lighting) p.lighting = { ...p.lighting, ...changes.lighting };
      if (changes.surface) p.surface = { ...p.surface, ...changes.surface };
      if (changes.name) p.name = changes.name;
      output(validatePalette(p, model));
      break;
    }
    default:
      process.stderr.write(
        'Usage: npm run palette -- parts|new|validate|edit|recommend|inventory-validate [--model manifest.json] [--in palette.json] [--patch changes.json] [--out NEW-file.json]\nOutputs JSON to stdout; --out refuses to overwrite an existing file.\n',
      );
      process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ error: (error as Error).message }) + '\n');
  process.exitCode = 1;
}
