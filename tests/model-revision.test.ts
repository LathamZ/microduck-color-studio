import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelRevision, withRevision } from '../scripts/model-revision';

const MANIFEST = {
  modelId: 'test-duck',
  geometryUrl: 'full.glb',
  mobileGeometryUrl: 'mobile.glb',
  rollerGeometryUrl: 'rollers.glb',
};

let dir: string;
const write = (name: string, text: string) => writeFileSync(join(dir, name), text);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'model-revision-'));
  write('full.glb', 'full');
  write('mobile.glb', 'mobile');
  write('rollers.glb', 'rollers');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('model revision', () => {
  it('is the same name for the same files', () => {
    expect(modelRevision(dir, MANIFEST)).toBe(modelRevision(dir, MANIFEST));
  });

  it('moves when any one of the geometry files changes', () => {
    const before = modelRevision(dir, MANIFEST);
    write('mobile.glb', 'mobile, but different');
    expect(modelRevision(dir, MANIFEST)).not.toBe(before);
  });

  it('moves when the manifest points somewhere else, even at the same bytes', () => {
    const before = modelRevision(dir, MANIFEST);
    write('other.glb', 'full');
    expect(modelRevision(dir, { ...MANIFEST, geometryUrl: 'other.glb' })).not.toBe(before);
  });

  it('counts a query string as a different URL, since that is what the browser fetches', () => {
    expect(modelRevision(dir, { ...MANIFEST, geometryUrl: 'full.glb?v=2' })).not.toBe(
      modelRevision(dir, MANIFEST),
    );
  });

  it('still reads the file a query-stringed URL points at', () => {
    const query = { ...MANIFEST, geometryUrl: 'full.glb?v=2' };
    const before = modelRevision(dir, query);
    write('full.glb', 'full, but different');
    expect(modelRevision(dir, query)).not.toBe(before);
  });

  it('still names a pack whose geometry is missing', () => {
    expect(modelRevision(dir, { ...MANIFEST, geometryUrl: 'gone.glb' })).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('stamping a manifest', () => {
  const text = JSON.stringify({ modelId: 'test-duck', geometryUrl: 'full.glb' }, null, 2);

  it('adds the revision and changes nothing else', () => {
    expect(withRevision(text, 'abc123')).toBe(
      [
        '{',
        '  "modelId": "test-duck",',
        '  "geometryUrl": "full.glb",',
        '  "geometryRevision": "abc123"',
        '}',
      ].join('\n'),
    );
  });

  it('keeps the numbers exactly as the geometry pipeline wrote them', () => {
    const measured = '{\n  "geometryUrl": "full.glb",\n  "bounds": [\n    -5.0\n  ]\n}\n';
    expect(withRevision(measured, 'abc123')).toContain('-5.0');
  });

  it('leaves a manifest it cannot read alone', () => {
    expect(withRevision('not json', 'abc123')).toBe('not json');
  });

  it('leaves a manifest that names no geometry alone', () => {
    const other = '{"modelId": "test-duck"}';
    expect(withRevision(other, 'abc123')).toBe(other);
  });
});
