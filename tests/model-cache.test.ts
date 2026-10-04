import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { geometryKept, readGeometry } from '../src/model-cache';

const URL = 'https://example.test/models/microduck.glb';
const BYTES = new Uint8Array([1, 2, 3, 4]);

/** Enough of Cache Storage to tell one revision from another, which is all this module asks. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  return {
    stores,
    open: async (name: string) => {
      const entries = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, entries);
      return {
        // Cloned, because reading a body consumes it and a cache hands the same entry out again.
        match: async (url: string) => entries.get(url)?.clone(),
        put: async (url: string, response: Response) => {
          entries.set(url, response);
        },
      } as unknown as Cache;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
}

const globals = globalThis as { caches?: unknown; fetch?: unknown };
const realCaches = globals.caches;
const realFetch = globals.fetch;
let store: ReturnType<typeof fakeCaches>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = fakeCaches();
  globals.caches = store;
  fetchMock = vi.fn(async () => new Response(BYTES));
  globals.fetch = fetchMock;
});

afterEach(() => {
  globals.caches = realCaches;
  globals.fetch = realFetch;
});

/** Every cache this module made, as name -> the URLs in it. */
const held = () => new Map([...store.stores].map(([name, entries]) => [name, [...entries.keys()]]));

describe('geometry cache', () => {
  it('keeps nothing, and reads nothing back, without a revision to key it by', async () => {
    expect(await readGeometry(URL)).toEqual(BYTES.buffer);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.stores.size).toBe(0);
    expect(await geometryKept(URL)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing where the browser has no cache storage at all', async () => {
    globals.caches = undefined;
    expect(await readGeometry(URL, 'aaaa')).toEqual(BYTES.buffer);
    expect(await geometryKept(URL, 'aaaa')).toBe(false);
  });

  it('reads the copy it kept without asking the server again', async () => {
    await readGeometry(URL, 'aaaa');
    fetchMock.mockClear();
    expect(await readGeometry(URL, 'aaaa')).toEqual(BYTES.buffer);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await geometryKept(URL, 'aaaa')).toBe(true);
    expect([...held()]).toEqual([['microduck-color-studio:geometry:aaaa', [URL]]]);
  });

  it('fetches again when the revision moves, and drops what the old one held', async () => {
    await readGeometry(URL, 'aaaa');
    fetchMock.mockClear();
    await readGeometry(URL, 'bbbb');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([...held()]).toEqual([['microduck-color-studio:geometry:bbbb', [URL]]]);
  });

  it('leaves caches it does not own alone', async () => {
    store.stores.set('someone-elses-site', new Map());
    await readGeometry(URL, 'aaaa');
    expect([...store.stores.keys()]).toContain('someone-elses-site');
  });

  it('hands back the file even when the browser refuses to keep it', async () => {
    store.open = async () => {
      throw new Error('quota');
    };
    expect(await readGeometry(URL, 'aaaa')).toEqual(BYTES.buffer);
    store.open = async (name: string) => {
      const entries = new Map<string, Response>();
      store.stores.set(name, entries);
      return {
        match: async () => undefined,
        put: async () => {
          throw new Error('quota');
        },
      } as unknown as Cache;
    };
    expect(await readGeometry(URL, 'aaaa')).toEqual(BYTES.buffer);
  });

  it('treats an entry with nothing in it as no copy at all', async () => {
    await store.open('microduck-color-studio:geometry:aaaa');
    store.stores.get('microduck-color-studio:geometry:aaaa')!.set(URL, new Response(''));
    fetchMock.mockClear();
    expect(await readGeometry(URL, 'aaaa')).toEqual(BYTES.buffer);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says which of a set is still missing', async () => {
    await readGeometry(URL, 'aaaa');
    expect(await geometryKept(URL, 'aaaa')).toBe(true);
    expect(await geometryKept('https://example.test/models/microduck-rollers.glb', 'aaaa')).toBe(
      false,
    );
  });

  it('refuses a file the server would not hand over', async () => {
    globals.fetch = vi.fn(async () => new Response('', { status: 404 }));
    await expect(readGeometry(URL, 'aaaa')).rejects.toThrow('404');
  });
});
