import { describe, it, expect, beforeEach } from 'vitest'
import { EnhancedMCP } from '../../src/EnhancedMCP'
import { SlackAdapter } from '../../src/adapters/slack'
import { GenericAdapter } from '../../src/adapters/generic'

const figmaResponse = {
  document: {
    id: 'doc-1',
    name: 'Design System',
    type: 'DOCUMENT',
    children: [
      {
        id: 'frame-dashboard',
        name: 'Dashboard',
        type: 'FRAME',
        absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
        fills: [],
        children: [
          {
            id: 'btn-submit',
            name: 'Submit Button',
            type: 'COMPONENT',
            absoluteBoundingBox: { x: 1200, y: 50, width: 160, height: 44 },
            fills: [{ type: 'SOLID', color: { r: 0.05, g: 0.6, b: 1, a: 1 } }],
            cornerRadius: 8,
            children: [],
          },
        ],
      },
    ],
  },
}

const notionResponse = {
  id: 'page-dashboard',
  object: 'page',
  created_time: '2024-01-10T09:00:00Z',
  last_edited_time: '2024-01-20T16:00:00Z',
  properties: {
    Name: { type: 'title', title: [{ plain_text: 'Dashboard' }] },
  },
  parent: { type: 'workspace', workspace: true },
}

const slackResponse = {
  ok: true,
  messages: [
    {
      ts: '1711000000.000001',
      text: 'Dashboard design is approved and ready to ship!',
      user: 'U001',
    },
  ],
}

describe('EnhancedMCP integration', () => {
  let client: EnhancedMCP

  beforeEach(() => {
    client = new EnhancedMCP({
      adapters: [new SlackAdapter(), new GenericAdapter()],
      enrichment: 'full',
      diffTracking: true,
    })
  })

  it('processes a Figma response', async () => {
    const ctx = await client.process({
      toolName: 'figma_get_file',
      serverId: 'figma',
      content: figmaResponse,
    })

    expect(ctx.schema).toBe('emcp/v1')
    expect(ctx.meta.totalNodes).toBeGreaterThan(0)
    expect(ctx.sources).toContain('figma')
  })

  it('extracts pixel-accurate coordinates', async () => {
    const ctx = await client.process({
      toolName: 'figma_get_file',
      serverId: 'figma',
      content: figmaResponse,
    })

    const button = ctx.nodes['btn-submit']
    expect(button).toBeDefined()
    expect(button.spatial?.x).toBe(1200)
    expect(button.spatial?.y).toBe(50)
    expect(button.spatial?.width).toBe(160)
    expect(button.spatial?.height).toBe(44)
    expect(button.confidence.spatial).toBe(0.99)
  })

  it('builds parent-child tree correctly', async () => {
    const ctx = await client.process({
      toolName: 'figma_get_file',
      serverId: 'figma',
      content: figmaResponse,
    })

    const frame = ctx.nodes['frame-dashboard']
    expect(frame.children).toContain('btn-submit')

    const button = ctx.nodes['btn-submit']
    expect(button.parentId).toBe('frame-dashboard')
  })

  it('processes multiple servers and auto-links by name', async () => {
    const ctx = await client.processMany([
      { toolName: 'figma_get_file', serverId: 'figma', content: figmaResponse },
      { toolName: 'notion-fetch', serverId: 'notion', content: notionResponse },
    ])

    expect(ctx.sources).toContain('figma')
    expect(ctx.sources).toContain('notion')

    // Both have a node named "Dashboard" — should be auto-linked
    const figmaFrame = ctx.nodes['frame-dashboard']
    const notionPage = ctx.nodes['notion:page-dashboard']

    expect(figmaFrame).toBeDefined()
    expect(notionPage).toBeDefined()

    // Check cross-server links were created
    const hasLink =
      figmaFrame.linkedNodes?.some((l) => l.nodeId === 'notion:page-dashboard') ||
      notionPage.linkedNodes?.some((l) => l.nodeId === 'frame-dashboard')

    expect(hasLink).toBe(true)
  })

  it('processes Slack messages', async () => {
    const ctx = await client.process({
      toolName: 'slack_get_messages',
      serverId: 'slack',
      content: slackResponse,
    })

    expect(ctx.sources).toContain('slack')
    expect(ctx.meta.totalNodes).toBe(1)
  })

  it('outputs valid JSON', async () => {
    await client.process({
      toolName: 'figma_get_file',
      serverId: 'figma',
      content: figmaResponse,
    })

    const json = await client.getJSON()
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('outputs valid XML', async () => {
    await client.process({
      toolName: 'figma_get_file',
      serverId: 'figma',
      content: figmaResponse,
    })

    const xml = await client.getXML()
    expect(xml).toContain('<?xml version="1.0"')
    expect(xml).toContain('<emcp schema="emcp/v1"')
    expect(xml).toContain('</emcp>')
  })

  it('outputs pixel manifest with only spatial nodes', async () => {
    await client.process({
      toolName: 'figma_get_file',
      serverId: 'figma',
      content: figmaResponse,
    })

    const manifest = await client.getPixelManifest()
    expect(manifest.length).toBeGreaterThan(0)
    for (const entry of manifest) {
      expect(typeof entry.x).toBe('number')
      expect(typeof entry.y).toBe('number')
      expect(typeof entry.width).toBe('number')
      expect(typeof entry.height).toBe('number')
    }
  })

  it('tracks diffs between process calls', async () => {
    await client.process({
      toolName: 'figma_get_file',
      serverId: 'figma',
      content: figmaResponse,
    })

    // Second call with same data — should have no added nodes
    const ctx2 = await client.process({
      toolName: 'figma_get_file',
      serverId: 'figma',
      content: figmaResponse,
    })

    expect(ctx2.diff).toBeDefined()
  })

  it('clearContext resets registry', async () => {
    await client.process({
      toolName: 'figma_get_file',
      serverId: 'figma',
      content: figmaResponse,
    })

    client.clearContext()
    const ctx = await client.getContext()
    expect(ctx.meta.totalNodes).toBe(0)
  })

  it('manually link nodes across servers', async () => {
    await client.processMany([
      { toolName: 'figma_get_file', serverId: 'figma', content: figmaResponse },
      { toolName: 'notion-fetch', serverId: 'notion', content: notionResponse },
    ])

    client.linkNodes('btn-submit', 'notion:page-dashboard', 'references')

    const ctx = await client.getContext()
    const button = ctx.nodes['btn-submit']
    expect(button.linkedNodes?.some((l) => l.nodeId === 'notion:page-dashboard')).toBe(true)
  })
})
