import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Bounds, DesignDocument, DesignNode } from '$lib/model/types';
import type { SessionRender } from './contracts';

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function color(value: string, opacity: number) {
  const match = /^#([\da-f]{6})$/i.exec(value);
  if (!match) return [217, 221, 227, Math.round(opacity * 255)] as const;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, Math.round(opacity * 255)] as const;
}

function png(document: DesignDocument, bounds: Bounds, nodeIds: string[]) {
  const scale = Math.min(1, 1024 / bounds.width, 1024 / bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const pixels = Buffer.alloc(width * height * 4, 255);
  const nodes = nodeIds
    .map((id) => document.nodes[id])
    .filter((node): node is DesignNode => Boolean(node));
  for (const node of nodes) {
    const [r, g, b, a] = color(node.style.fill, node.style.opacity);
    const left = Math.max(0, Math.floor((node.bounds.x - bounds.x) * scale));
    const top = Math.max(0, Math.floor((node.bounds.y - bounds.y) * scale));
    const right = Math.min(
      width,
      Math.ceil((node.bounds.x + node.bounds.width - bounds.x) * scale),
    );
    const bottom = Math.min(
      height,
      Math.ceil((node.bounds.y + node.bounds.height - bounds.y) * scale),
    );
    for (let y = top; y < bottom; y += 1)
      for (let x = left; x < right; x += 1) {
        const offset = (y * width + x) * 4;
        const alpha = a / 255;
        pixels[offset] = Math.round(r * alpha + pixels[offset] * (1 - alpha));
        pixels[offset + 1] = Math.round(g * alpha + pixels[offset + 1] * (1 - alpha));
        pixels[offset + 2] = Math.round(b * alpha + pixels[offset + 2] * (1 - alpha));
        pixels[offset + 3] = 255;
      }
  }
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const destination = y * (width * 4 + 1);
    raw[destination] = 0;
    pixels.copy(raw, destination + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return {
    bytes: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
    width,
    height,
  };
}

function defaultBounds(document: DesignDocument, nodeIds: string[]) {
  const nodes = nodeIds.map((id) => document.nodes[id]).filter(Boolean);
  if (!nodes.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...nodes.map((node) => node.bounds.x));
  const y = Math.min(...nodes.map((node) => node.bounds.y));
  const right = Math.max(...nodes.map((node) => node.bounds.x + node.bounds.width));
  const bottom = Math.max(...nodes.map((node) => node.bounds.y + node.bounds.height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export class RenderSessionService {
  private readonly directories = new Map<string, string>();
  private readonly cache = new Map<string, SessionRender>();

  async render(input: {
    sessionId: string;
    document: DesignDocument;
    view: 'source' | 'candidate';
    nodeIds: string[];
    bounds?: Bounds;
  }): Promise<SessionRender> {
    const bounds = input.bounds ?? defaultBounds(input.document, input.nodeIds);
    const identity = JSON.stringify({
      sessionId: input.sessionId,
      revision: input.document.currentRevisionId,
      view: input.view,
      nodeIds: input.nodeIds,
      bounds,
    });
    const key = createHash('sha256').update(identity).digest('hex');
    const cached = this.cache.get(key);
    if (cached) return cached;
    let directory = this.directories.get(input.sessionId);
    if (!directory) {
      directory = await mkdtemp(join(tmpdir(), `codesign-session-${input.sessionId}-`));
      this.directories.set(input.sessionId, directory);
    }
    const rendered = png(input.document, bounds, input.nodeIds);
    const sha256 = createHash('sha256').update(rendered.bytes).digest('hex');
    const path = join(directory, `${key}.png`);
    await writeFile(path, rendered.bytes, { mode: 0o600 });
    const artifact: SessionRender = {
      id: `render-${key.slice(0, 16)}`,
      path,
      mimeType: 'image/png',
      width: rendered.width,
      height: rendered.height,
      sha256,
      view: input.view,
      bounds,
    };
    this.cache.set(key, artifact);
    return artifact;
  }

  async cleanupSession(sessionId: string) {
    const directory = this.directories.get(sessionId);
    if (directory) await rm(directory, { recursive: true, force: true });
    this.directories.delete(sessionId);
    for (const [key, render] of this.cache)
      if (render.path.startsWith(`${directory}/`)) this.cache.delete(key);
  }

  async dispose() {
    await Promise.all([...this.directories].map(([sessionId]) => this.cleanupSession(sessionId)));
  }
}
