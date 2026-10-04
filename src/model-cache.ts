/**
 * Keep the display geometry in the browser, and go and fetch it again only when it is a new
 * version.
 *
 * The GLBs are the whole transfer budget of this page — about four megabytes of it — and they
 * change far less often than the code around them. So they are kept, and the manifest's
 * revision says whether what was kept is still what the server has. Nothing else is kept here:
 * the manifest is the version, and it has to be read fresh for the version to mean anything.
 *
 * One cache per revision, named by it, so a hit is a hit by construction — there is no separate
 * note saying which version a cache holds, and so nothing that can disagree with what it holds.
 */
/** Every cache this app owns starts with this. github.io is one origin for every Pages site on
 *  the account, so a sweep for old revisions has to be able to tell ours from someone else's. */
const PREFIX = 'microduck-color-studio:geometry:';

/** Absent in old browsers, and in any context the browser does not consider secure. */
const storage = () => (typeof caches === 'undefined' ? null : caches);

/** The revision the geometry is being read for, or null when it cannot be kept at all. */
async function open(revision?: string): Promise<Cache | null> {
  const store = storage();
  if (!store || !revision) return null;
  const wanted = `${PREFIX}${revision}`;
  const cache = await store.open(wanted).catch(() => null);
  if (!cache) return null;
  const names = await store.keys().catch(() => []);
  await Promise.all(
    names
      .filter((name) => name.startsWith(PREFIX) && name !== wanted)
      .map((name) => store.delete(name).catch(() => false)),
  );
  return cache;
}

async function kept(cache: Cache | null, url: string): Promise<ArrayBuffer | null> {
  if (!cache) return null;
  const response = await cache.match(url).catch(() => undefined);
  if (!response) return null;
  const bytes = await response.arrayBuffer().catch(() => new ArrayBuffer(0));
  // An entry with nothing in it is not a copy of anything. Nothing else can go wrong with one:
  // the browser either has the whole entry or does not have it.
  return bytes.byteLength ? bytes : null;
}

async function keep(cache: Cache, url: string, bytes: ArrayBuffer) {
  // Built from the bytes in hand rather than from the response they came in, so the entry carries
  // no content-encoding. A stored copy of a response that still claims to be compressed, with a
  // body the browser has already decoded, is the usual way a cache hands back a corrupt file.
  const response = new Response(bytes, { headers: { 'Content-Type': 'model/gltf-binary' } });
  await cache.put(url, response).catch(() => undefined);
}

/**
 * Whether the copy kept from last time is already here, so the caller can say what is about to
 * happen before it happens. The file itself is not read.
 */
export async function geometryKept(url: string, revision?: string): Promise<boolean> {
  return (await kept(await open(revision), url)) !== null;
}

/**
 * One geometry file, from the copy kept from last time if there is one.
 *
 * Without a revision there is no way to tell one version of a file from another, so nothing is
 * kept and nothing is read back — which is exactly how this page behaved before it had a cache,
 * and what every browser that refuses storage still gets.
 */
export async function readGeometry(url: string, revision?: string): Promise<ArrayBuffer> {
  const cache = await open(revision);
  const stored = await kept(cache, url);
  if (stored) return stored;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法下载模型几何体：${response.status}`);
  const bytes = await response.arrayBuffer();
  if (cache && bytes.byteLength) await keep(cache, url, bytes);
  return bytes;
}
