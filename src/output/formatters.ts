import type { EnrichedContext, EnrichedNode } from '../core/types.js'

// ─── JSON formatter ────────────────────────────────────────────────────────────

export function toJSON(ctx: EnrichedContext, pretty = false): string {
  return pretty ? JSON.stringify(ctx, null, 2) : JSON.stringify(ctx)
}

// ─── XML formatter ────────────────────────────────────────────────────────────

export function toXML(ctx: EnrichedContext): string {
  const lines: string[] = []

  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push(`<emcp schema="${ctx.schema}" timestamp="${ctx.timestamp}">`)
  lines.push(`  <meta totalNodes="${ctx.meta.totalNodes}" enrichmentMs="${ctx.meta.enrichmentMs}" averageConfidence="${ctx.meta.averageConfidence}"/>`)
  lines.push(`  <sources>`)
  for (const src of ctx.sources) {
    lines.push(`    <source>${escapeXml(src)}</source>`)
  }
  lines.push(`  </sources>`)

  lines.push(`  <nodes>`)
  for (const id of ctx.rootIds) {
    const node = ctx.nodes[id]
    if (node) {
      lines.push(...nodeToXML(node, ctx.nodes, 2))
    }
  }
  lines.push(`  </nodes>`)

  if (ctx.diff) {
    lines.push(`  <diff>`)
    for (const id of ctx.diff.added) lines.push(`    <added id="${id}"/>`)
    for (const id of ctx.diff.removed) lines.push(`    <removed id="${id}"/>`)
    for (const id of ctx.diff.modified) lines.push(`    <modified id="${id}"/>`)
    lines.push(`  </diff>`)
  }

  lines.push(`</emcp>`)
  return lines.join('\n')
}

function nodeToXML(
  node: EnrichedNode,
  allNodes: Record<string, EnrichedNode>,
  indent: number
): string[] {
  const pad = ' '.repeat(indent * 2)
  const lines: string[] = []

  const attrs = [
    `id="${escapeXml(node.id)}"`,
    `name="${escapeXml(node.name)}"`,
    `type="${node.type}"`,
    `role="${node.role}"`,
    `source="${node.source}"`,
    `depth="${node.depth}"`,
  ].join(' ')

  lines.push(`${pad}<node ${attrs}>`)

  if (node.label) {
    lines.push(`${pad}  <label>${escapeXml(node.label)}</label>`)
  }

  if (node.spatial) {
    const { x, y, width, height, zIndex, rotation } = node.spatial
    const spatialAttrs = [
      `x="${x}"`, `y="${y}"`, `width="${width}"`, `height="${height}"`,
      zIndex !== undefined ? `zIndex="${zIndex}"` : '',
      rotation !== undefined ? `rotation="${rotation}"` : '',
    ].filter(Boolean).join(' ')
    lines.push(`${pad}  <spatial ${spatialAttrs}/>`)
  }

  if (node.style) {
    const { fill, opacity, fontSize, fontFamily, fontWeight, borderRadius } = node.style
    const styleAttrs = [
      fill ? `fill="${escapeXml(fill)}"` : '',
      opacity !== undefined ? `opacity="${opacity}"` : '',
      fontSize !== undefined ? `fontSize="${fontSize}"` : '',
      fontFamily ? `fontFamily="${escapeXml(fontFamily)}"` : '',
      fontWeight !== undefined ? `fontWeight="${fontWeight}"` : '',
      borderRadius !== undefined ? `borderRadius="${borderRadius}"` : '',
    ].filter(Boolean).join(' ')
    if (styleAttrs) lines.push(`${pad}  <style ${styleAttrs}/>`)
  }

  const { spatial: sp, semantic, style: st, overall } = node.confidence
  lines.push(`${pad}  <confidence spatial="${sp}" semantic="${semantic}" style="${st}" overall="${overall}"/>`)

  if (node.linkedNodes && node.linkedNodes.length > 0) {
    lines.push(`${pad}  <links>`)
    for (const link of node.linkedNodes) {
      lines.push(`${pad}    <link nodeId="${escapeXml(link.nodeId)}" source="${escapeXml(link.source)}" type="${link.linkType}"/>`)
    }
    lines.push(`${pad}  </links>`)
  }

  if (node.children.length > 0) {
    lines.push(`${pad}  <children>`)
    for (const childId of node.children) {
      const child = allNodes[childId]
      if (child) {
        lines.push(...nodeToXML(child, allNodes, indent + 2))
      }
    }
    lines.push(`${pad}  </children>`)
  }

  lines.push(`${pad}</node>`)
  return lines
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ─── Pixel manifest ────────────────────────────────────────────────────────────
// Flat list of all nodes with spatial data — ideal for layout tools.

export interface PixelManifestEntry {
  id: string
  name: string
  type: string
  source: string
  x: number
  y: number
  width: number
  height: number
  zIndex?: number
  fill?: string
  confidence: number
}

export function toPixelManifest(ctx: EnrichedContext): PixelManifestEntry[] {
  return Object.values(ctx.nodes)
    .filter((n) => n.spatial !== undefined)
    .map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      source: n.source,
      x: n.spatial!.x,
      y: n.spatial!.y,
      width: n.spatial!.width,
      height: n.spatial!.height,
      zIndex: n.spatial!.zIndex,
      fill: n.style?.fill,
      confidence: n.confidence.overall,
    }))
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
}
