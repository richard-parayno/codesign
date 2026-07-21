import { orderedScreenNodes } from '$lib/model/layers';
import type { Bounds, DesignDocument, GenerationTarget } from '$lib/model/types';

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

function unionBounds(bounds: Bounds[]) {
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function sceneSnapshotSvg(document: DesignDocument, target: GenerationTarget) {
  const observed = new Set(target.observationScope.nodeIds);
  const nodes = orderedScreenNodes(document, document.activeScreenId).filter((node) =>
    observed.has(node.id),
  );
  if (!nodes.length) throw new Error('The observation scope has no renderable layers');
  const root = target.observationScope.rootId
    ? document.nodes[target.observationScope.rootId]
    : undefined;
  const bounds = root?.bounds ?? unionBounds(nodes.map((node) => node.bounds));
  const observedNodes = new Map(nodes.map((node) => [node.id, node]));
  const clippingFrameId = (nodeId: string) => {
    let parent = observedNodes.get(nodeId)?.parentId
      ? observedNodes.get(observedNodes.get(nodeId)!.parentId!)
      : undefined;
    const seen = new Set<string>();
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      if (parent.kind === 'frame' && parent.clipContent) return parent.id;
      parent = parent.parentId ? observedNodes.get(parent.parentId) : undefined;
    }
    return undefined;
  };
  const defs = nodes
    .filter((node) => node.kind === 'frame' && node.clipContent)
    .map(
      (node) =>
        `<clipPath id="snapshot-clip-${escapeXml(node.id)}"><rect x="${node.bounds.x}" y="${node.bounds.y}" width="${node.bounds.width}" height="${node.bounds.height}" rx="${node.style.radius}"/></clipPath>`,
    )
    .join('');
  const body = nodes
    .map((node) => {
      const stroke = node.style.stroke
        ? ` stroke="${escapeXml(node.style.stroke)}" stroke-width="${node.style.strokeWidth ?? 1}"`
        : '';
      const rect = `<rect x="${node.bounds.x}" y="${node.bounds.y}" width="${node.bounds.width}" height="${node.bounds.height}" rx="${node.style.radius}" fill="${escapeXml(node.style.fill)}"${stroke}/>`;
      const clip = clippingFrameId(node.id);
      const wrapper = (content: string) =>
        `<g opacity="${node.style.opacity}"${clip ? ` clip-path="url(#snapshot-clip-${escapeXml(clip)})"` : ''}>${content}</g>`;
      if (!node.text) return wrapper(rect);
      const textAnchor =
        node.style.textAlign === 'center'
          ? 'middle'
          : node.style.textAlign === 'right'
            ? 'end'
            : 'start';
      const x =
        node.style.textAlign === 'center'
          ? node.bounds.x + node.bounds.width / 2
          : node.style.textAlign === 'right'
            ? node.bounds.x + node.bounds.width - node.style.padding
            : node.bounds.x + node.style.padding;
      const y = node.bounds.y + node.style.padding + node.style.fontSize;
      const text = `<text x="${x}" y="${y}" text-anchor="${textAnchor}" fill="${escapeXml(node.style.textColor)}" font-family="system-ui, sans-serif" font-size="${node.style.fontSize}" font-weight="${node.style.fontWeight}">${escapeXml(node.text)}</text>`;
      return wrapper(`${rect}${text}`);
    })
    .join('');
  return {
    bounds,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><defs>${defs}</defs>${body}</svg>`,
  };
}

export async function captureSceneSnapshot(document: DesignDocument, target: GenerationTarget) {
  const { svg, bounds } = sceneSnapshotSvg(document, target);
  const scale = Math.min(2, 1600 / Math.max(bounds.width, bounds.height, 1));
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const canvas = window.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not create a snapshot canvas');
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/png');
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return {
      id: `scene-${document.currentRevisionId}-${Date.now().toString(36)}`,
      mimeType: 'image/png' as const,
      width,
      height,
      data,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
