/**
 * emcp — basic usage example
 *
 * This shows how to wrap any MCP server response with emcp
 * and get structured, pixel-accurate, cross-server context.
 */

import { EnhancedMCP, FigmaAdapter, NotionAdapter } from '../src/index.js'
import { SlackAdapter } from '../src/adapters/slack/index.js'
import { GenericAdapter } from '../src/adapters/generic/index.js'

// ─── 1. Basic setup ────────────────────────────────────────────────────────────

const client = new EnhancedMCP({
  enrichment: 'full',
  output: 'json',
  diffTracking: true,
  debug: true,
})

// Register additional adapters
client.registerAdapter(new SlackAdapter())
client.registerAdapter(new GenericAdapter())

// ─── 2. Process a Figma MCP response ──────────────────────────────────────────
// This is what you get back from Figma's MCP server after calling get_file

const figmaRawResponse = {
  document: {
    id: 'doc-1',
    name: 'Design System',
    type: 'DOCUMENT',
    children: [
      {
        id: 'frame-home',
        name: 'Home Screen',
        type: 'FRAME',
        absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
        children: [
          {
            id: 'btn-cta',
            name: 'Primary CTA Button',
            type: 'COMPONENT',
            absoluteBoundingBox: { x: 24, y: 780, width: 342, height: 52 },
            fills: [{ type: 'SOLID', color: { r: 0.05, g: 0.4, b: 0.98, a: 1 } }],
            cornerRadius: 12,
            characters: 'Get started',
            children: [],
          },
        ],
      },
    ],
  },
}

async function runExample() {
  // Process Figma response
  const figmaCtx = await client.process({
    toolName: 'figma_get_file',
    serverId: 'figma',
    content: figmaRawResponse,
  })

  console.log('=== Figma Context ===')
  console.log(`Nodes: ${figmaCtx.meta.totalNodes}`)
  console.log(`Average confidence: ${figmaCtx.meta.averageConfidence}`)

  const button = figmaCtx.nodes['btn-cta']
  if (button) {
    console.log('\n=== Button node ===')
    console.log(`Type:       ${button.type}`)
    console.log(`Label:      ${button.label}`)
    console.log(`Position:   x=${button.spatial?.x}, y=${button.spatial?.y}`)
    console.log(`Size:       ${button.spatial?.width}×${button.spatial?.height}`)
    console.log(`Fill:       ${button.style?.fill}`)
    console.log(`Confidence: ${button.confidence.overall}`)
  }

  // ─── 3. Cross-server: add Notion context ─────────────────────────────────

  const notionRawResponse = {
    id: 'page-home',
    object: 'page',
    created_time: '2024-03-01T10:00:00Z',
    last_edited_time: '2024-03-20T09:00:00Z',
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'Home Screen' }] },
      Status: { type: 'select', select: { name: 'Approved' } },
    },
    parent: { type: 'workspace', workspace: true },
  }

  const crossCtx = await client.processMany([
    { toolName: 'figma_get_file', serverId: 'figma', content: figmaRawResponse },
    { toolName: 'notion-fetch', serverId: 'notion', content: notionRawResponse },
  ])

  console.log('\n=== Cross-server context ===')
  console.log(`Sources: ${crossCtx.sources.join(', ')}`)
  console.log(`Total nodes: ${crossCtx.meta.totalNodes}`)

  // Nodes auto-linked by matching name "Home Screen"
  const frame = crossCtx.nodes['frame-home']
  if (frame?.linkedNodes?.length) {
    console.log(`\nAuto-linked "${frame.name}" across:`)
    for (const link of frame.linkedNodes) {
      console.log(`  → ${link.source}:${link.nodeId} [${link.linkType}]`)
    }
  }

  // ─── 4. Output formats ────────────────────────────────────────────────────

  const json = await client.getJSON(true)
  console.log('\n=== JSON output (truncated) ===')
  console.log(json.slice(0, 300) + '...')

  const pixels = await client.getPixelManifest()
  console.log('\n=== Pixel manifest ===')
  console.log(JSON.stringify(pixels, null, 2))

  const xml = await client.getXML()
  console.log('\n=== XML output (truncated) ===')
  console.log(xml.slice(0, 400) + '...')
}

runExample().catch(console.error)
