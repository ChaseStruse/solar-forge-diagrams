import { findService } from '../catalog/services';
import type { DiagramDocument } from '../domain/document';
import { worldPosition } from '../domain/document';
import { obstaclesOf, routeEdge } from '../domain/routing';
import { fontSize, wrapText } from '../domain/text';

const xmlText = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c] ?? c,
  );
export async function exportSvg(doc: DiagramDocument): Promise<string> {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const positioned = doc.nodes.map((node) => ({
    node,
    p: worldPosition(node, nodes),
  }));
  const obstacles = obstaclesOf(nodes);
  const routes = doc.edges.map((edge) => ({
    edge,
    ...routeEdge(edge, nodes, obstacles),
  }));
  const xs = [
    ...positioned.flatMap(({ node, p }) => [
      p.x - node.width / 2,
      p.x + node.width / 2,
    ]),
    ...routes.flatMap((r) => r.points.map((p) => p.x)),
  ];
  const zs = [
    ...positioned.flatMap(({ node, p }) => [
      p.z - node.depth / 2 - 30,
      p.z + node.depth / 2 + 60,
    ]),
    ...routes.flatMap((r) => r.points.map((p) => p.z)),
  ];
  const minX = xs.reduce((a, b) => Math.min(a, b), 0) - 50,
    minZ = zs.reduce((a, b) => Math.min(a, b), 0) - 50,
    width = Math.max(200, xs.reduce((a, b) => Math.max(a, b), 0) - minX + 50),
    height = Math.max(160, zs.reduce((a, b) => Math.max(a, b), 0) - minZ + 50);
  const icons = new Map<string, string>();
  const assets = import.meta.glob<string>('../../assets/*/*.svg', {
    query: '?raw',
    import: 'default',
  });
  const needed = [
    ...new Set(
      doc.nodes
        .map((node) => findService(node.serviceId ?? node.label)?.asset)
        .filter((asset): asset is string => !!asset),
    ),
  ];
  await Promise.all(
    needed.map(async (asset) => {
      const load = assets[`../../assets/${asset}`];
      if (!load) throw Error('Missing bundled export icon');
      const bytes = new TextEncoder().encode(await load());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      icons.set(asset, `data:image/svg+xml;base64,${btoa(binary)}`);
    }),
  );
  const groups = positioned
    .filter(({ node }) => node.kind === 'group')
    .sort((a, b) => a.p.level - b.p.level)
    .map(
      ({ node, p }) =>
        `<g><title>${xmlText(node.label)}</title><rect x="${p.x - node.width / 2}" y="${p.z - node.depth / 2}" width="${node.width}" height="${node.depth}" rx="8" fill="#f2f5f8" stroke="${node.color}" stroke-width="2"/><text x="${p.x - node.width / 2 + 14}" y="${p.z - node.depth / 2 + 24}" fill="#43546b" font-size="15">${xmlText(node.label)}</text></g>`,
    )
    .join('');
  const edges = routes
    .map(({ edge, points }) => {
      const mid = points[Math.floor(points.length / 2)];
      return `<g><path d="${points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.z}`).join(' ')}" fill="none" stroke="#576b84" stroke-width="2" marker-end="url(#arrow)"/>${mid && edge.label ? `<text x="${mid.x}" y="${mid.z - 12}" text-anchor="middle" fill="#243449" paint-order="stroke" stroke="#fff" stroke-width="5" font-size="14">${xmlText(edge.label)}</text>` : ''}</g>`;
    })
    .join('');
  const services = positioned
    .filter(({ node }) => node.kind === 'service')
    .map(({ node, p }) => {
      const x = p.x - node.width / 2,
        z = p.z - node.depth / 2;
      const service = findService(node.serviceId ?? node.label);
      const image = service?.asset ? icons.get(service.asset) : undefined;
      const shape =
        node.shape === 'decision'
          ? `<polygon points="${p.x},${z} ${x + node.width},${p.z} ${p.x},${z + node.depth} ${x},${p.z}"`
          : `<rect x="${x}" y="${z}" width="${node.width}" height="${node.depth}" rx="${node.shape === 'terminal' ? node.depth / 2 : 8}"`;
      return `<g><title>${xmlText(node.label)}</title>${shape} fill="#fff" stroke="${node.color}" stroke-width="2"/>${image && !node.shape ? `<image href="${image}" x="${p.x - 26}" y="${p.z - 26}" width="52" height="52"/>` : ''}<text x="${p.x}" y="${node.shape ? p.z + 5 : z + node.depth + 26}" text-anchor="middle" font-size="16" fill="#172c43">${xmlText(node.label)}</text></g>`;
    })
    .join('');
  const annotations = positioned
    .filter(({ node }) => node.kind === 'text' || node.kind === 'note')
    .map(({ node, p }) => {
      const note = node.kind === 'note';
      const x = p.x - node.width / 2,
        z = p.z - node.depth / 2;
      const size = fontSize(node);
      const padding = note ? 14 : 4;
      // Approximate glyph width; SVG has no layout engine to wrap for us.
      const lines = wrapText(
        node.label,
        node.width - padding * 2,
        (text) => text.length * size * 0.56,
      ).slice(
        0,
        Math.max(1, Math.floor((node.depth - padding) / (size * 1.28))),
      );
      const text = lines
        .map(
          (line, i) =>
            `<tspan x="${x + padding}" dy="${i ? size * 1.28 : size}">${xmlText(line)}</tspan>`,
        )
        .join('');
      return `<g>${note ? `<rect x="${x}" y="${z}" width="${node.width}" height="${node.depth}" rx="3" fill="${node.color}" stroke="#00000022"/>` : ''}<text x="${x + padding}" y="${z + padding}" font-size="${size}" font-weight="${note ? 500 : 600}" fill="${note ? '#2a2010' : '#172c43'}">${text}</text></g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="${minX} ${minZ} ${width} ${height}" role="img" aria-label="${xmlText(doc.title)}"><title>${xmlText(doc.title)}</title><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 8 4 0 8" fill="#576b84"/></marker></defs><rect x="${minX}" y="${minZ}" width="${width}" height="${height}" fill="#fff"/><g font-family="system-ui, sans-serif">${groups}${edges}${services}${annotations}</g></svg>`;
}
