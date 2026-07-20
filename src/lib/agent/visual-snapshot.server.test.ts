import { createHash } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  validateVisualSnapshot,
  VISUAL_SNAPSHOT_LIMITS,
  VisualSnapshotError,
  withTrustedVisualSnapshot,
} from './visual-snapshot.server';

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), result.length - 4);
  return result;
}

function makePng(width = 2, height = 2) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) rows[row * (width * 4 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function dataUrl(bytes: Buffer, mimeType = 'image/png') {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

async function expectRemoved(path: string) {
  await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('trusted visual snapshots', () => {
  it('accepts strict data URL, base64, and byte payloads', () => {
    const png = makePng(3, 4);
    expect(validateVisualSnapshot(dataUrl(png))).toMatchObject({
      mimeType: 'image/png',
      width: 3,
      height: 4,
    });
    expect(
      validateVisualSnapshot({ mimeType: 'image/png', base64: png.toString('base64') }),
    ).toMatchObject({ width: 3, height: 4 });
    expect(
      validateVisualSnapshot({ mimeType: 'image/png', bytes: new Uint8Array(png) }),
    ).toMatchObject({ width: 3, height: 4 });
  });

  it('recognizes structurally decodable JPEG and WebP payloads', () => {
    const jpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Q/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=',
      'base64',
    );
    const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBo', 'base64');
    expect(validateVisualSnapshot({ mimeType: 'image/jpeg', bytes: jpeg })).toMatchObject({
      width: 1,
      height: 1,
    });
    expect(validateVisualSnapshot({ mimeType: 'image/webp', bytes: webp })).toMatchObject({
      width: 1,
      height: 1,
    });
  });

  it('rejects paths, URLs, extra fields, MIME spoofing, and noncanonical base64', () => {
    const png = makePng();
    expect(() => validateVisualSnapshot('/tmp/untrusted.png')).toThrow('never a path or URL');
    expect(() => validateVisualSnapshot('https://example.test/image.png')).toThrow(
      'never a path or URL',
    );
    expect(() =>
      validateVisualSnapshot({ mimeType: 'image/png', bytes: png, path: '/tmp/injected' }),
    ).toThrow('unsupported fields');
    expect(() => validateVisualSnapshot({ mimeType: 'image/jpeg', bytes: png })).toThrowError(
      expect.objectContaining({ code: 'mime-mismatch' }),
    );
    expect(() =>
      validateVisualSnapshot({ mimeType: 'image/png', base64: `${png.toString('base64')}\n` }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-base64' }));
  });

  it('rejects malformed image bytes even when their signature and MIME agree', () => {
    const truncated = makePng().subarray(0, 40);
    expect(() => validateVisualSnapshot({ mimeType: 'image/png', bytes: truncated })).toThrowError(
      expect.objectContaining({ code: 'malformed-image' }),
    );

    const corruptChecksum = makePng();
    corruptChecksum[corruptChecksum.length - 1] ^= 0xff;
    expect(() => validateVisualSnapshot({ mimeType: 'image/png', bytes: corruptChecksum })).toThrow(
      'checksum',
    );
  });

  it('enforces encoded and decoded byte limits before image parsing', () => {
    expect(() =>
      validateVisualSnapshot({
        mimeType: 'image/png',
        base64: 'A'.repeat(VISUAL_SNAPSHOT_LIMITS.maxEncodedBytes + 4),
      }),
    ).toThrowError(expect.objectContaining({ code: 'too-large' }));
    expect(() =>
      validateVisualSnapshot({
        mimeType: 'image/png',
        bytes: new Uint8Array(VISUAL_SNAPSHOT_LIMITS.maxDecodedBytes + 1),
      }),
    ).toThrowError(expect.objectContaining({ code: 'too-large' }));
  });

  it('rejects decoded dimensions outside conservative bounds', () => {
    const tooWide = makePng(VISUAL_SNAPSHOT_LIMITS.maxWidth + 1, 1);
    expect(() => validateVisualSnapshot({ mimeType: 'image/png', bytes: tooWide })).toThrowError(
      expect.objectContaining({ code: 'invalid-dimensions' }),
    );
  });

  it('computes trusted metadata server-side and removes the process-owned file after success', async () => {
    const png = makePng(7, 5);
    let trustedPath = '';
    const result = await withTrustedVisualSnapshot(
      { mimeType: 'image/png', bytes: png },
      async (snapshot) => {
        trustedPath = snapshot.path;
        expect(isAbsolute(snapshot.path)).toBe(true);
        expect(snapshot.path).toContain(`codesign-visual-${process.pid}-`);
        expect(snapshot).toMatchObject({
          mimeType: 'image/png',
          extension: '.png',
          byteLength: png.length,
          width: 7,
          height: 5,
          sha256: createHash('sha256').update(png).digest('hex'),
        });
        expect(await readFile(snapshot.path)).toEqual(png);
        expect((await stat(snapshot.path)).mode & 0o777).toBe(0o600);
        expect((await stat(new URL('.', `file://${snapshot.path}`))).mode & 0o777).toBe(0o700);
        return 'accepted';
      },
    );
    expect(result).toBe('accepted');
    await expectRemoved(trustedPath);
  });

  it('removes the trusted file when the callback fails', async () => {
    let trustedPath = '';
    await expect(
      withTrustedVisualSnapshot({ mimeType: 'image/png', bytes: makePng() }, (snapshot) => {
        trustedPath = snapshot.path;
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');
    await expectRemoved(trustedPath);
  });

  it('removes the trusted file when the callback is cancelled', async () => {
    const controller = new AbortController();
    let trustedPath = '';
    let callbackAborted = false;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const pending = withTrustedVisualSnapshot(
      { mimeType: 'image/png', bytes: makePng() },
      (snapshot, signal) => {
        trustedPath = snapshot.path;
        signal.addEventListener('abort', () => (callbackAborted = true));
        markStarted();
        return new Promise<never>(() => undefined);
      },
      { signal: controller.signal },
    );
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(callbackAborted).toBe(true);
    await expectRemoved(trustedPath);
  });

  it('removes the trusted file when the callback times out', async () => {
    let trustedPath = '';
    let callbackAborted = false;
    const pending = withTrustedVisualSnapshot(
      { mimeType: 'image/png', bytes: makePng() },
      (snapshot, signal) => {
        trustedPath = snapshot.path;
        signal.addEventListener('abort', () => (callbackAborted = true));
        return new Promise<never>(() => undefined);
      },
      { timeoutMs: 5 },
    );
    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
    expect(callbackAborted).toBe(true);
    await expectRemoved(trustedPath);
  });

  it('uses typed validation failures for endpoint-safe handling', () => {
    try {
      validateVisualSnapshot({ mimeType: 'image/gif', base64: 'AAAA' });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(VisualSnapshotError);
      expect(error).toMatchObject({ code: 'unsupported-mime' });
    }
  });
});
