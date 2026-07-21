import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join } from 'node:path';
import { inflateSync } from 'node:zlib';

export const VISUAL_SNAPSHOT_LIMITS = Object.freeze({
  maxDecodedBytes: 5 * 1024 * 1024,
  maxEncodedBytes: Math.ceil((5 * 1024 * 1024) / 3) * 4,
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixels: 16_777_216,
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 120_000,
});

const MIME_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
} as const;

export type VisualSnapshotMimeType = keyof typeof MIME_EXTENSIONS;
export type VisualSnapshotInput =
  | string
  | { dataUrl: string }
  | { mimeType: VisualSnapshotMimeType; base64: string }
  | { mimeType: VisualSnapshotMimeType; bytes: Uint8Array | ArrayBuffer };

export type TrustedVisualSnapshot = Readonly<{
  path: string;
  mimeType: VisualSnapshotMimeType;
  extension: '.png' | '.jpg' | '.webp';
  byteLength: number;
  width: number;
  height: number;
  sha256: string;
}>;

export type TrustedVisualSnapshotLease = Readonly<{
  snapshot: TrustedVisualSnapshot;
  dispose: () => Promise<void>;
}>;

export type VisualSnapshotOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export class VisualSnapshotError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid-input'
      | 'invalid-base64'
      | 'unsupported-mime'
      | 'mime-mismatch'
      | 'malformed-image'
      | 'too-large'
      | 'invalid-dimensions'
      | 'cancelled'
      | 'timeout',
  ) {
    super(message);
    this.name = 'VisualSnapshotError';
  }
}

type ParsedSnapshot = {
  bytes: Buffer;
  mimeType: VisualSnapshotMimeType;
  width: number;
  height: number;
};

function fail(message: string, code: VisualSnapshotError['code']): never {
  throw new VisualSnapshotError(message, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseMimeType(value: unknown): VisualSnapshotMimeType {
  if (typeof value !== 'string' || !(value in MIME_EXTENSIONS))
    fail(
      'Visual snapshot MIME type must be image/png, image/jpeg, or image/webp',
      'unsupported-mime',
    );
  return value as VisualSnapshotMimeType;
}

function decodeBase64(value: unknown) {
  if (typeof value !== 'string' || !value.length)
    fail('Visual snapshot base64 payload is required', 'invalid-base64');
  if (value.length > VISUAL_SNAPSHOT_LIMITS.maxEncodedBytes)
    fail('Visual snapshot encoded payload is too large', 'too-large');
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    fail('Visual snapshot payload is not canonical base64', 'invalid-base64');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value)
    fail('Visual snapshot payload is not canonical base64', 'invalid-base64');
  if (!bytes.length) fail('Visual snapshot bytes are empty', 'malformed-image');
  if (bytes.length > VISUAL_SNAPSHOT_LIMITS.maxDecodedBytes)
    fail('Visual snapshot decoded payload is too large', 'too-large');
  return bytes;
}

function copyBytes(value: unknown) {
  let bytes: Buffer;
  if (value instanceof ArrayBuffer) bytes = Buffer.from(new Uint8Array(value));
  else if (value instanceof Uint8Array) bytes = Buffer.from(value);
  else fail('Visual snapshot bytes must be an ArrayBuffer or Uint8Array', 'invalid-input');
  if (!bytes.length) fail('Visual snapshot bytes are empty', 'malformed-image');
  if (bytes.length > VISUAL_SNAPSHOT_LIMITS.maxDecodedBytes)
    fail('Visual snapshot decoded payload is too large', 'too-large');
  return Buffer.from(bytes);
}

function extractPayload(input: unknown) {
  if (typeof input === 'string') {
    if (!input.startsWith('data:'))
      fail('Visual snapshots must be uploaded bytes, never a path or URL', 'invalid-input');
    return extractDataUrl(input);
  }
  if (!isRecord(input)) fail('Visual snapshot input is invalid', 'invalid-input');
  if (hasExactKeys(input, ['dataUrl'])) {
    if (typeof input.dataUrl !== 'string')
      fail('Visual snapshot data URL must be a string', 'invalid-input');
    return extractDataUrl(input.dataUrl);
  }
  if (hasExactKeys(input, ['mimeType', 'base64']))
    return { mimeType: parseMimeType(input.mimeType), bytes: decodeBase64(input.base64) };
  if (hasExactKeys(input, ['mimeType', 'bytes']))
    return { mimeType: parseMimeType(input.mimeType), bytes: copyBytes(input.bytes) };
  fail('Visual snapshot input contains unsupported fields', 'invalid-input');
}

function extractDataUrl(dataUrl: string) {
  if (dataUrl.length > VISUAL_SNAPSHOT_LIMITS.maxEncodedBytes + 64)
    fail('Visual snapshot encoded payload is too large', 'too-large');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match) {
    if (/^data:image\//.test(dataUrl))
      fail('Visual snapshot data URL has an unsupported MIME type or encoding', 'unsupported-mime');
    fail('Visual snapshot must be a base64 image data URL', 'invalid-input');
  }
  return { mimeType: parseMimeType(match[1]), bytes: decodeBase64(match[2]) };
}

function readU24LE(bytes: Buffer, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePng(bytes: Buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(signature))
    fail('PNG signature is invalid', 'mime-mismatch');
  if (bytes.length < 45) fail('PNG structure is truncated', 'malformed-image');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let sawHeader = false;
  let sawPalette = false;
  let sawData = false;
  let dataEnded = false;
  let sawEnd = false;
  const compressed: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail('PNG chunk is truncated', 'malformed-image');
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) fail('PNG chunk length exceeds the payload', 'malformed-image');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase())
      fail('PNG chunk type is invalid', 'malformed-image');
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== expectedCrc)
      fail('PNG chunk checksum is invalid', 'malformed-image');
    if (!sawHeader && type !== 'IHDR') fail('PNG IHDR must be the first chunk', 'malformed-image');
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) fail('PNG IHDR is invalid', 'malformed-image');
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      const validDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !validDepths[colorType]?.includes(bitDepth) ||
        chunk[10] !== 0 ||
        chunk[11] !== 0 ||
        chunk[12] !== 0
      )
        fail('PNG encoding parameters are unsupported', 'malformed-image');
      assertDimensions(width, height);
      sawHeader = true;
    } else if (type === 'PLTE') {
      if (
        sawPalette ||
        sawData ||
        colorType === 0 ||
        colorType === 4 ||
        length < 3 ||
        length > 768 ||
        length % 3 !== 0 ||
        (colorType === 3 && length / 3 > 2 ** bitDepth)
      )
        fail('PNG palette is invalid', 'malformed-image');
      sawPalette = true;
    } else if (type === 'IDAT') {
      if (!sawHeader || sawEnd || dataEnded || !length)
        fail('PNG image data is invalid', 'malformed-image');
      if (colorType === 3 && !sawPalette)
        fail('Indexed PNG image is missing its palette', 'malformed-image');
      sawData = true;
      compressed.push(chunk);
    } else if (type === 'IEND') {
      if (!sawData || sawEnd || length !== 0) fail('PNG end chunk is invalid', 'malformed-image');
      sawEnd = true;
      if (end !== bytes.length) fail('PNG has trailing bytes after IEND', 'malformed-image');
    } else if (type[0] === type[0].toUpperCase()) {
      fail('PNG contains an unsupported critical chunk', 'malformed-image');
    }
    if (sawData && type !== 'IDAT' && type !== 'IEND') dataEnded = true;
    offset = end;
  }
  if (!sawHeader || !sawData || !sawEnd) fail('PNG structure is incomplete', 'malformed-image');
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const rowBytes = Math.ceil((width * channels[colorType] * bitDepth) / 8);
  const expectedInflated = (rowBytes + 1) * height;
  if (expectedInflated > 128 * 1024 * 1024)
    fail('PNG decoded raster is too large', 'invalid-dimensions');
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedInflated + 1 });
  } catch {
    fail('PNG image data cannot be decoded', 'malformed-image');
  }
  if (inflated.length !== expectedInflated)
    fail('PNG decoded raster length is invalid', 'malformed-image');
  for (let row = 0; row < height; row++)
    if (inflated[row * (rowBytes + 1)] > 4)
      fail('PNG row uses an invalid filter', 'malformed-image');
  return { width, height };
}

function parseJpeg(bytes: Buffer) {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    fail('JPEG signature is invalid', 'mime-mismatch');
  if (bytes.length < 16) fail('JPEG structure is truncated', 'malformed-image');
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawFrame = false;
  let sawScan = false;
  let sawQuantizationTable = false;
  let sawHuffmanTable = false;
  let scanBytes = 0;
  let inScan = false;
  while (offset < bytes.length) {
    if (inScan) {
      if (bytes[offset] !== 0xff) {
        scanBytes++;
        offset++;
        continue;
      }
      const markerStart = offset;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) fail('JPEG scan data is truncated', 'malformed-image');
      const marker = bytes[offset];
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
        if (marker === 0x00) scanBytes++;
        offset++;
        continue;
      }
      if (!scanBytes) fail('JPEG scan has no entropy-coded data', 'malformed-image');
      offset = markerStart;
      inScan = false;
      continue;
    }
    if (bytes[offset] !== 0xff) fail('JPEG marker boundary is invalid', 'malformed-image');
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) fail('JPEG marker is truncated', 'malformed-image');
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (
        !sawFrame ||
        !sawScan ||
        !sawQuantizationTable ||
        !sawHuffmanTable ||
        offset !== bytes.length
      )
        fail('JPEG image structure is incomplete', 'malformed-image');
      return { width, height };
    }
    if (marker === 0xd8 || marker === 0x00)
      fail('JPEG contains an invalid standalone marker', 'malformed-image');
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) fail('JPEG segment is truncated', 'malformed-image');
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length)
      fail('JPEG segment length is invalid', 'malformed-image');
    const dataOffset = offset + 2;
    const dataLength = length - 2;
    const isFrame = marker === 0xc0 || marker === 0xc1 || marker === 0xc2;
    const isUnsupportedFrame =
      marker === 0xc3 ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isUnsupportedFrame)
      fail('JPEG frame encoding is unsupported for visual snapshots', 'malformed-image');
    if (isFrame) {
      if (sawFrame || dataLength < 6) fail('JPEG frame header is invalid', 'malformed-image');
      if (bytes[dataOffset] !== 8 && bytes[dataOffset] !== 12)
        fail('JPEG sample precision is unsupported', 'malformed-image');
      height = bytes.readUInt16BE(dataOffset + 1);
      width = bytes.readUInt16BE(dataOffset + 3);
      const components = bytes[dataOffset + 5];
      if (dataLength !== 6 + components * 3 || !components)
        fail('JPEG frame components are invalid', 'malformed-image');
      sawFrame = true;
    }
    if (marker === 0xdb) {
      let tableOffset = dataOffset;
      const tableEnd = dataOffset + dataLength;
      while (tableOffset < tableEnd) {
        const info = bytes[tableOffset++];
        const precision = info >>> 4;
        if (precision > 1 || (info & 0x0f) > 3)
          fail('JPEG quantization table is invalid', 'malformed-image');
        tableOffset += precision ? 128 : 64;
        if (tableOffset > tableEnd) fail('JPEG quantization table is truncated', 'malformed-image');
        sawQuantizationTable = true;
      }
    }
    if (marker === 0xc4) {
      let tableOffset = dataOffset;
      const tableEnd = dataOffset + dataLength;
      while (tableOffset < tableEnd) {
        const info = bytes[tableOffset++];
        if (info >>> 4 > 1 || (info & 0x0f) > 3 || tableOffset + 16 > tableEnd)
          fail('JPEG Huffman table is invalid', 'malformed-image');
        let symbolCount = 0;
        for (let index = 0; index < 16; index++) symbolCount += bytes[tableOffset + index];
        tableOffset += 16 + symbolCount;
        if (!symbolCount || tableOffset > tableEnd)
          fail('JPEG Huffman table is truncated', 'malformed-image');
        sawHuffmanTable = true;
      }
    }
    if (marker === 0xda) {
      if (!sawFrame || dataLength < 6) fail('JPEG scan header is invalid', 'malformed-image');
      const components = bytes[dataOffset];
      if (!components || dataLength !== 1 + components * 2 + 3)
        fail('JPEG scan components are invalid', 'malformed-image');
      sawScan = true;
      inScan = true;
    }
    offset += length;
  }
  fail('JPEG is missing its end marker', 'malformed-image');
}

function parseWebp(bytes: Buffer) {
  if (
    bytes.length < 12 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  )
    fail('WebP signature is invalid', 'mime-mismatch');
  if (bytes.length < 30) fail('WebP structure is truncated', 'malformed-image');
  if (bytes.readUInt32LE(4) + 8 !== bytes.length)
    fail('WebP RIFF length is invalid', 'malformed-image');
  let offset = 12;
  let width = 0;
  let height = 0;
  let extended = false;
  let sawImage = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail('WebP chunk is truncated', 'malformed-image');
    const type = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const end = dataOffset + length;
    if (end > bytes.length) fail('WebP chunk length exceeds the payload', 'malformed-image');
    if (type === 'VP8X') {
      if (offset !== 12 || extended || length !== 10)
        fail('WebP extended header is invalid', 'malformed-image');
      if ((bytes[dataOffset] & 0x02) !== 0)
        fail('Animated WebP snapshots are unsupported', 'malformed-image');
      if ((bytes[dataOffset] & 0xc1) !== 0)
        fail('WebP extended header has nonzero reserved flags', 'malformed-image');
      if (bytes[dataOffset + 1] || bytes[dataOffset + 2] || bytes[dataOffset + 3])
        fail('WebP extended header has nonzero reserved bits', 'malformed-image');
      width = readU24LE(bytes, dataOffset + 4) + 1;
      height = readU24LE(bytes, dataOffset + 7) + 1;
      extended = true;
    } else if (type === 'VP8 ') {
      if (sawImage || length < 10) fail('WebP lossy image chunk is invalid', 'malformed-image');
      if (
        (bytes[dataOffset] & 1) !== 0 ||
        (bytes[dataOffset] & 0x10) === 0 ||
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      )
        fail('WebP lossy frame header is invalid', 'malformed-image');
      const frameTag = bytes.readUIntLE(dataOffset, 3);
      const firstPartitionLength = frameTag >>> 5;
      if (!firstPartitionLength || 10 + firstPartitionLength > length)
        fail('WebP lossy frame partition is truncated', 'malformed-image');
      const frameWidth = bytes.readUInt16LE(dataOffset + 6) & 0x3fff;
      const frameHeight = bytes.readUInt16LE(dataOffset + 8) & 0x3fff;
      if (extended && (frameWidth !== width || frameHeight !== height))
        fail('WebP canvas and frame dimensions disagree', 'malformed-image');
      width = frameWidth;
      height = frameHeight;
      sawImage = true;
    } else if (type === 'VP8L') {
      if (sawImage || length < 6 || bytes[dataOffset] !== 0x2f)
        fail('WebP lossless image chunk is invalid', 'malformed-image');
      const bits = bytes.readUInt32LE(dataOffset + 1);
      if (bits >>> 29) fail('WebP lossless version is unsupported', 'malformed-image');
      const frameWidth = (bits & 0x3fff) + 1;
      const frameHeight = ((bits >>> 14) & 0x3fff) + 1;
      if (extended && (frameWidth !== width || frameHeight !== height))
        fail('WebP canvas and frame dimensions disagree', 'malformed-image');
      width = frameWidth;
      height = frameHeight;
      sawImage = true;
    }
    if ((length & 1) !== 0 && bytes[end] !== 0)
      fail('WebP chunk padding is invalid', 'malformed-image');
    offset = end + (length & 1);
    if (offset > bytes.length) fail('WebP padding is truncated', 'malformed-image');
  }
  if (!sawImage || offset !== bytes.length) fail('WebP image data is missing', 'malformed-image');
  return { width, height };
}

function detectedMime(bytes: Buffer): VisualSnapshotMimeType | undefined {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
}

function assertDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > VISUAL_SNAPSHOT_LIMITS.maxWidth ||
    height > VISUAL_SNAPSHOT_LIMITS.maxHeight ||
    width * height > VISUAL_SNAPSHOT_LIMITS.maxPixels
  )
    fail('Visual snapshot dimensions exceed the safe canvas bounds', 'invalid-dimensions');
}

export function validateVisualSnapshot(input: unknown): ParsedSnapshot {
  const { mimeType, bytes } = extractPayload(input);
  const detected = detectedMime(bytes);
  if (!detected || detected !== mimeType)
    fail('Visual snapshot MIME type does not match its bytes', 'mime-mismatch');
  const dimensions =
    detected === 'image/png'
      ? parsePng(bytes)
      : detected === 'image/jpeg'
        ? parseJpeg(bytes)
        : parseWebp(bytes);
  assertDimensions(dimensions.width, dimensions.height);
  return { bytes, mimeType: detected, ...dimensions };
}

function cancellationError() {
  return new VisualSnapshotError('Visual snapshot callback was cancelled', 'cancelled');
}

function timeoutError() {
  return new VisualSnapshotError('Visual snapshot preparation timed out', 'timeout');
}

function validatedTimeout(options: VisualSnapshotOptions) {
  const timeoutMs = options.timeoutMs ?? VISUAL_SNAPSHOT_LIMITS.defaultTimeoutMs;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > VISUAL_SNAPSHOT_LIMITS.maxTimeoutMs
  )
    fail('Visual snapshot timeout is outside the safe range', 'invalid-input');
  return timeoutMs;
}

/**
 * Materializes an uploaded image as a caller-owned resource. The timeout only
 * covers validation and file preparation; once returned, the lease remains
 * valid until it is explicitly disposed or its owning signal is aborted.
 */
export async function createTrustedVisualSnapshot(
  input: unknown,
  options: VisualSnapshotOptions = {},
): Promise<TrustedVisualSnapshotLease> {
  if (options.signal?.aborted) throw cancellationError();
  const timeoutMs = validatedTimeout(options);
  let directory: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let disposePromise: Promise<void> | undefined;

  const dispose = () => {
    if (!disposePromise)
      disposePromise = directory
        ? rm(directory, { recursive: true, force: true })
        : Promise.resolve();
    return disposePromise;
  };

  const preparation = (async () => {
    const parsed = validateVisualSnapshot(input);
    if (options.signal?.aborted) throw cancellationError();
    directory = await mkdtemp(join(tmpdir(), `codesign-visual-${process.pid}-`));
    await chmod(directory, 0o700);
    if (options.signal?.aborted) throw cancellationError();
    const extension = MIME_EXTENSIONS[parsed.mimeType];
    const path = join(directory, `snapshot${extension}`);
    await writeFile(path, parsed.bytes, { flag: 'wx', mode: 0o600 });
    if (options.signal?.aborted) throw cancellationError();
    if (!isAbsolute(path) || extname(path) !== extension)
      fail('Trusted visual snapshot path construction failed', 'invalid-input');
    return Object.freeze({
      path,
      mimeType: parsed.mimeType,
      extension,
      byteLength: parsed.bytes.length,
      width: parsed.width,
      height: parsed.height,
      sha256: createHash('sha256').update(parsed.bytes).digest('hex'),
    }) satisfies TrustedVisualSnapshot;
  })();

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError()), timeoutMs);
  });
  const cancellation = new Promise<never>((_, reject) => {
    if (!options.signal) return;
    onAbort = () => reject(cancellationError());
    options.signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    const snapshot = await Promise.race([preparation, timeout, cancellation]);
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
    // The owning request/session may still dispose the prepared resource after
    // creation. This listener is intentionally separate from the prep timeout.
    if (options.signal) {
      onAbort = () => void dispose();
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    return Object.freeze({
      snapshot,
      dispose: async () => {
        if (onAbort) options.signal?.removeEventListener('abort', onAbort);
        await dispose();
      },
    });
  } catch (error) {
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
    // File-system work cannot be synchronously cancelled. Let an in-flight
    // preparation settle before deleting its directory so a timeout cannot
    // leave a late-created artifact behind.
    await preparation.catch(() => undefined);
    await dispose();
    throw error;
  }
}

export async function withTrustedVisualSnapshot<T>(
  input: unknown,
  callback: (snapshot: TrustedVisualSnapshot, signal: AbortSignal) => T | Promise<T>,
  options: VisualSnapshotOptions = {},
): Promise<T> {
  const timeoutMs = validatedTimeout(options);
  const lease = await createTrustedVisualSnapshot(input, {
    signal: options.signal,
    timeoutMs: VISUAL_SNAPSHOT_LIMITS.defaultTimeoutMs,
  });
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const controller = new AbortController();
    const callbackPromise = Promise.resolve().then(() => callback(lease.snapshot, controller.signal));
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(timeoutError());
      }, timeoutMs);
    });
    const cancellationPromise = new Promise<never>((_, reject) => {
      if (!options.signal) return;
      if (options.signal.aborted) {
        reject(cancellationError());
        return;
      }
      onAbort = () => {
        controller.abort();
        reject(cancellationError());
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([callbackPromise, timeoutPromise, cancellationPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) options.signal?.removeEventListener('abort', onAbort);
    }
  } finally {
    await lease.dispose();
  }
}
