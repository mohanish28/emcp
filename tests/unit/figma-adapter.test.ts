import { describe, it, expect } from 'vitest'
import { FigmaAdapter } from '../../src/adapters/figma'

const mockFigmaNode = {
  id: 'node-1',
  name: 'Submit Button',
  type: 'COMPONENT',
  absoluteBoundingBox: { x: 100, y: 200, width: 120, height: 40 },
  fills: [{ type: 'SOLID', color: { r: 0.05, g: 0.6, b: 1, a: 1 } }],
  strokeWeight: 0,
  opacity: 1,
  cornerRadius: 8,
  children: [
    {
      id: 'node-1-1',
      name: 'Button Label',
      type: 'TEXT',
      absoluteBoundingBox: { x: 110, y: 210, width: 100, height: 20 },
      characters: 'Submit',
      fills: [],
      children: [],
    },
  ],
}

const mockFigmaFile = {
  document: {
    id: 'doc-1',
    name: 'Dashboard',
    type: 'DOCUMENT',
    children: [mockFigmaNode],
  },
  name: 'My Design File',
}

describe('FigmaAdapter', () => {
  const adapter = new FigmaAdapter()

  it('has correct name and version', () => {
    expect(adapter.name).toBe('figma')
    expect(adapter.version).toBe('1.0.0')
  })

  it('canHandle figma tool names', () => {
    expect(adapter.canHandle('figma_get_file', {})).toBe(true)
    expect(adapter.canHandle('get_file', {})).toBe(true)
    expect(adapter.canHandle('get_node', {})).toBe(true)
    expect(adapter.canHandle('get_frame', {})).toBe(true)
    expect(adapter.canHandle('unrelated_tool', {})).toBe(false)
  })

  it('parses a Figma file response', async () => {
    const nodes = await adapter.parse('get_file', mockFigmaFile)
    expect(nodes.length).toBeGreaterThan(0)

    const button = nodes.find((n) => n.id === 'node-1')
    expect(button).toBeDefined()
    expect(button!.name).toBe('Submit Button')
    expect(button!.source).toBe('figma')
  })

  it('extracts spatial data with pixel precision', async () => {
    const nodes = await adapter.parse('get_file', mockFigmaFile)
    const button = nodes.find((n) => n.id === 'node-1')!

    expect(button.spatial).toBeDefined()
    expect(button.spatial!.x).toBe(100)
    expect(button.spatial!.y).toBe(200)
    expect(button.spatial!.width).toBe(120)
    expect(button.spatial!.height).toBe(40)
  })

  it('extracts fill color as hex', async () => {
    const nodes = await adapter.parse('get_file', mockFigmaFile)
    const button = nodes.find((n) => n.id === 'node-1')!

    expect(button.style?.fill).toMatch(/^#[0-9a-f]{6}/i)
  })

  it('extracts border radius', async () => {
    const nodes = await adapter.parse('get_file', mockFigmaFile)
    const button = nodes.find((n) => n.id === 'node-1')!
    expect(button.style?.borderRadius).toBe(8)
  })

  it('assigns high spatial confidence when bbox present', async () => {
    const nodes = await adapter.parse('get_file', mockFigmaFile)
    const button = nodes.find((n) => n.id === 'node-1')!
    expect(button.confidence.spatial).toBe(0.99)
  })

  it('builds correct parent-child tree', async () => {
    const nodes = await adapter.parse('get_file', mockFigmaFile)
    const button = nodes.find((n) => n.id === 'node-1')!
    const label = nodes.find((n) => n.id === 'node-1-1')!

    expect(button.children).toContain('node-1-1')
    expect(label.parentId).toBe('node-1')
    expect(label.depth).toBe(1)
  })

  it('extracts text content as label', async () => {
    const nodes = await adapter.parse('get_file', mockFigmaFile)
    const label = nodes.find((n) => n.id === 'node-1-1')!
    expect(label.label).toBe('Submit')
  })

  it('returns schema version on every node', async () => {
    const nodes = await adapter.parse('get_file', mockFigmaFile)
    for (const node of nodes) {
      expect(node.schema).toBe('emcp/v1')
    }
  })

  it('parses direct node response', async () => {
    const nodes = await adapter.parse('get_node', mockFigmaNode)
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes[0].id).toBe('node-1')
  })

  it('returns empty array for unrecognized response', async () => {
    const nodes = await adapter.parse('get_file', { random: 'garbage' })
    expect(nodes).toEqual([])
  })
})
