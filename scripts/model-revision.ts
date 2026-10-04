/**
 * Name one set of display geometry, so a browser can tell whether the copy it kept is still the
 * copy on the server.
 *
 * The name is a hash of the files the manifest points at, so it cannot describe anything other
 * than what was actually built. A hand-kept version number is the version that eventually lies,
 * and a cache key that lies outlives the mistake: everyone who visited before keeps the old
 * geometry and never asks for it again.
 *
 * This is build-time code. `vite.config.ts` calls it; nothing under `src/` imports it.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The manifest fields that name a geometry file, in the order they are hashed. */
const URL_FIELDS = ['geometryUrl', 'mobileGeometryUrl', 'rollerGeometryUrl'] as const;

export const REVISION_FIELD = 'geometryRevision';

type Manifestish = Partial<Record<(typeof URL_FIELDS)[number], unknown>>;

/**
 * A short, stable name for the geometry this manifest describes.
 *
 * The URL goes into the hash as well as the bytes, so pointing the manifest at a different file
 * is a different revision even before that file is read. A file that is not there contributes
 * its URL alone: a broken pack still gets a name, and the name still changes when the pack does.
 */
export function modelRevision(modelsDir: string, manifest: Manifestish): string {
  const hash = createHash('sha256');
  for (const field of URL_FIELDS) {
    const value = manifest[field];
    if (typeof value !== 'string') continue;
    hash.update(field).update('\0').update(value).update('\0');
    // The URL as written is already in the hash above: the browser fetches that exact string, so
    // a change to it is a change. The file it names is found without its query string.
    const name = value.split(/[?#]/)[0];
    try {
      hash.update(readFileSync(join(modelsDir, name)));
    } catch {
      // No such file: the URL above already went in, and that is the whole of what we know.
    }
  }
  return hash.digest('hex').slice(0, 12);
}

/** What the geometry files looked like when a revision was last worked out. */
export function revisionKey(modelsDir: string, manifest: Manifestish): string {
  const parts: string[] = [];
  for (const field of URL_FIELDS) {
    const value = manifest[field];
    if (typeof value !== 'string') continue;
    const name = value.split(/[?#]/)[0];
    try {
      const stat = statSync(join(modelsDir, name));
      parts.push(`${name}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      parts.push(`${name}:missing`);
    }
  }
  return parts.join('|');
}

/**
 * The manifest with its revision written in, as JSON text.
 *
 * The field is spliced into the text rather than re-serialised, because the manifest is written
 * by the geometry pipeline and `JSON.stringify` would rewrite every `-5.0` in it as `-5`. The
 * served file should differ from the committed one by this line and nothing else.
 *
 * Returns the input untouched if it does not parse or does not name any geometry: a manifest
 * this cannot read is not one to guess at, and the client treats a manifest without a revision
 * as one it must not cache.
 */
export function withRevision(text: string, revision: string): string {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }
  if (!URL_FIELDS.some((field) => typeof manifest[field] === 'string')) return text;
  const end = text.lastIndexOf('}');
  if (end < 0) return text;
  const head = text.slice(0, end).trimEnd();
  const comma = head.endsWith('{') ? '' : ',';
  const field = `${comma}\n  ${JSON.stringify(REVISION_FIELD)}: ${JSON.stringify(revision)}`;
  return `${head}${field}\n${text.slice(end)}`;
}
