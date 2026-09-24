#!/usr/bin/env node
/**
 * Compress the exported display GLBs with EXT_meshopt_compression.
 *
 * This is the last step of the geometry pipeline, not a step inside it: build_mobile_model.py
 * reads microduck.glb back in, and trimesh cannot read a compressed file. So run this after
 * build_model.py, build_mobile_model.py and build_rollers.py, and only then.
 *
 * The mesh is not touched — vertex data comes back byte for byte, and the index codec returns the
 * same triangles in the same order with the same winding — and every view is decoded back and
 * compared before the file is written, so a file that fails the round trip is left as it was.
 *
 * Usage: npm run models:compress
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const models = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
const FILES = ['microduck.glb', 'microduck-mobile.glb', 'microduck-rollers.glb'];

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const EXT = 'EXT_meshopt_compression';

interface Accessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}
interface BufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
}
interface Gltf {
  accessors: Accessor[];
  bufferViews: BufferView[];
  buffers: { byteLength: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

/** Split a GLB into its JSON and binary chunks. */
function parseGlb(bytes: Buffer): { json: Gltf; bin: Buffer } {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
  const binLength = bytes.readUInt32LE(20 + jsonLength);
  return { json, bin: bytes.subarray(28 + jsonLength, 28 + jsonLength + binLength) };
}

function buildGlb(json: Gltf, bin: Buffer): Buffer {
  const jsonChunk = Buffer.from(JSON.stringify(json));
  const jsonPad = Buffer.alloc((4 - (jsonChunk.length % 4)) % 4, 0x20);
  const binPad = Buffer.alloc((4 - (bin.length % 4)) % 4);
  const jsonPadded = Buffer.concat([jsonChunk, jsonPad]);
  const binPadded = Buffer.concat([bin, binPad]);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]);
}

/** Which view is a vertex attribute and which is an index buffer, and how wide each element is. */
interface Role {
  mode: string;
  count: number;
  stride: number;
  element: number;
}
function describeViews(json: Gltf): Map<number, Role> {
  const views = new Map<number, Role>();
  const record = (accessorIndex: number, mode: string) => {
    const accessor = json.accessors[accessorIndex];
    const element = COMPONENT_BYTES[accessor.componentType] * COMPONENTS[accessor.type];
    const view = json.bufferViews[accessor.bufferView];
    const stride = mode === 'ATTRIBUTES' ? (view.byteStride ?? element) : element;
    views.set(accessor.bufferView, { mode, count: accessor.count, stride, element });
  };
  for (const mesh of json.meshes)
    for (const primitive of mesh.primitives) {
      for (const accessorIndex of Object.values(primitive.attributes))
        record(accessorIndex, 'ATTRIBUTES');
      if (primitive.indices !== undefined) record(primitive.indices, 'TRIANGLES');
    }
  return views;
}

/**
 * Whether the decoded view says the same thing as the bytes that went into the encoder.
 *
 * The index codec is lossless in the only sense that matters — the same triangles, in the same
 * order, with the same winding — but it is free to list a triangle from a different one of its
 * three corners. A swap of two corners would flip the winding, which is a different mesh, so only
 * the three rotations are accepted. Vertex data has to come back byte for byte.
 */
function survived(role: Role, original: Buffer, decoded: Uint8Array): boolean {
  if (original.length < role.count * role.element) return false;
  const indices = (source: Uint8Array) => {
    const view = new DataView(source.buffer, source.byteOffset, role.count * role.element);
    const read = role.element === 4 ? 'getUint32' : 'getUint16';
    const out = new Array<number>(role.count);
    for (let index = 0; index < role.count; index++)
      out[index] = view[read](index * role.element, true);
    return out;
  };
  if (role.mode === 'TRIANGLES') {
    const before = indices(original);
    const after = indices(decoded);
    for (let index = 0; index < role.count; index += 3)
      if (!(
        (before[index] === after[index] &&
          before[index + 1] === after[index + 1] &&
          before[index + 2] === after[index + 2]) ||
        (before[index] === after[index + 1] &&
          before[index + 1] === after[index + 2] &&
          before[index + 2] === after[index]) ||
        (before[index] === after[index + 2] &&
          before[index + 1] === after[index] &&
          before[index + 2] === after[index + 1])
      ))
        return false;
    return true;
  }
  // Element by element, so a strided view is judged on its vertices and not on the padding
  // between them — the decoder leaves that padding zeroed, whatever was there before.
  for (let element = 0; element < role.count; element++)
    for (let byte = 0; byte < role.element; byte++)
      if (decoded[element * role.stride + byte] !== original[element * role.element + byte])
        return false;
  return true;
}

function compress(bytes: Buffer): Buffer {
  const { json, bin } = parseGlb(bytes);
  if (json.extensionsRequired?.includes(EXT))
    throw new Error('already compressed — rebuild the geometry before compressing again');
  if (json.buffers.length !== 1)
    throw new Error(`expected one buffer, found ${json.buffers.length}`);

  const described = describeViews(json);
  const encoded: Buffer[] = [];
  const views: BufferView[] = [];
  let offset = 0;

  for (let index = 0; index < json.bufferViews.length; index++) {
    const view = json.bufferViews[index];
    const described1 = described.get(index);
    if (!described1) throw new Error(`bufferView ${index} is not reached from any primitive`);
    const start = view.byteOffset ?? 0;
    const source = bin.subarray(start, start + view.byteLength);
    const packed = MeshoptEncoder.encodeGltfBuffer(
      new Uint8Array(source),
      described1.count,
      described1.stride,
      described1.mode,
    );
    while (offset % 4) {
      encoded.push(Buffer.alloc(1));
      offset++;
    }
    views.push({
      byteLength: 0,
      extensions: {
        [EXT]: {
          buffer: 0,
          byteOffset: offset,
          byteLength: packed.byteLength,
          byteStride: described1.stride,
          count: described1.count,
          mode: described1.mode,
          filter: 'NONE',
        },
      },
    } as unknown as BufferView);
    encoded.push(Buffer.from(packed));
    offset += packed.byteLength;
  }

  const compressed = Buffer.concat(encoded);

  // Decode every view back and compare it with what went in. The encoder is only allowed to
  // change the encoding, and this is what says so for this file rather than in general.
  const decoder = MeshoptDecoder as unknown as {
    supported: boolean;
    ready: Promise<void>;
    decodeGltfBuffer(
      target: Uint8Array,
      count: number,
      size: number,
      source: Uint8Array,
      mode: string,
      filter?: string,
    ): void;
  };
  if (!decoder.supported) throw new Error('meshopt decoder is unavailable');
  for (let index = 0; index < views.length; index++) {
    const view = views[index] as unknown as {
      extensions: Record<
        string,
        { byteOffset: number; byteLength: number; byteStride: number; count: number; mode: string }
      >;
    };
    const def = view.extensions[EXT];
    const role = described.get(index)!;
    const start = json.bufferViews[index].byteOffset ?? 0;
    const original = bin.subarray(start, start + json.bufferViews[index].byteLength);
    const target = new Uint8Array(role.count * role.stride);
    decoder.decodeGltfBuffer(
      target,
      role.count,
      role.stride,
      new Uint8Array(compressed.subarray(def.byteOffset, def.byteOffset + def.byteLength)),
      def.mode,
    );
    if (!survived(role, original, target))
      throw new Error(`bufferView ${index} did not survive the round trip`);
  }

  json.bufferViews = views;
  json.buffers = [{ byteLength: compressed.length }];
  for (const accessor of json.accessors) accessor.byteOffset = 0;
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), EXT])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), EXT])];
  return buildGlb(json, compressed);
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  for (const name of FILES) {
    const path = join(models, name);
    const before = readFileSync(path);
    const after = compress(before);
    writeFileSync(path, after);
    const percent = ((1 - after.length / before.length) * 100).toFixed(1);
    console.log(
      `${name.padEnd(26)} ${before.length.toLocaleString().padStart(11)} -> ${after.length.toLocaleString().padStart(11)}  (-${percent}%)`,
    );
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
