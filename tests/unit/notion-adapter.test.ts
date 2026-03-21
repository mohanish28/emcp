import { describe, it, expect } from 'vitest'
import { NotionAdapter } from '../../src/adapters/notion'

const mockNotionPage = {
  id: 'page-abc-123',
  object: 'page',
  url: 'https://notion.so/page-abc-123',
  created_time: '2024-01-15T10:00:00Z',
  last_edited_time: '2024-01-20T14:30:00Z',
  properties: {
    Name: {
      type: 'title',
      title: [{ plain_text: 'Dashboard Design Spec' }],
    },
    Status: {
      type: 'select',
      select: { name: 'In Progress' },
    },
  },
  parent: { type: 'workspace', workspace: true },
}

const mockNotionDatabase = {
  id: 'db-xyz-789',
  object: 'database',
  title: [{ plain_text: 'Design System Components' }],
  url: 'https://notion.so/db-xyz-789',
  created_time: '2024-01-01T00:00:00Z',
  properties: {
    Name: { type: 'title', id: 'title' },
    Status: { type: 'select', id: 'status' },
  },
}

const mockNotionBlock = {
  id: 'block-001',
  object: 'block',
  type: 'heading_1',
  heading_1: { rich_text: [{ plain_text: 'Introduction' }] },
  has_children: false,
  created_time: '2024-01-15T10:00:00Z',
}

const mockListResponse = {
  results: [mockNotionPage, mockNotionDatabase],
  has_more: false,
}

describe('NotionAdapter', () => {
  const adapter = new NotionAdapter()

  it('has correct name', () => {
    expect(adapter.name).toBe('notion')
  })

  it('canHandle notion tool names', () => {
    expect(adapter.canHandle('notion-fetch', {})).toBe(true)
    expect(adapter.canHandle('notion-search', {})).toBe(true)
    expect(adapter.canHandle('query_database', {})).toBe(true)
    expect(adapter.canHandle('get_page', {})).toBe(true)
    expect(adapter.canHandle('figma_get_file', {})).toBe(false)
  })

  it('parses a single page', async () => {
    const nodes = await adapter.parse('get_page', mockNotionPage)
    expect(nodes.length).toBe(1)
    const page = nodes[0]
    expect(page.name).toBe('Dashboard Design Spec')
    expect(page.type).toBe('PAGE')
    expect(page.source).toBe('notion')
    expect(page.sourceId).toBe('page-abc-123')
  })

  it('extracts page title as label', async () => {
    const nodes = await adapter.parse('get_page', mockNotionPage)
    expect(nodes[0].label).toBe('Dashboard Design Spec')
  })

  it('parses a database', async () => {
    const nodes = await adapter.parse('query_database', mockNotionDatabase)
    expect(nodes.length).toBe(1)
    const db = nodes[0]
    expect(db.type).toBe('DATABASE')
    expect(db.name).toBe('Design System Components')
  })

  it('parses a block', async () => {
    const nodes = await adapter.parse('get_block', mockNotionBlock)
    expect(nodes.length).toBe(1)
    expect(nodes[0].label).toBe('Introduction')
  })

  it('parses list response', async () => {
    const nodes = await adapter.parse('notion-search', mockListResponse)
    expect(nodes.length).toBe(2)
  })

  it('uses notion: prefix in id', async () => {
    const nodes = await adapter.parse('get_page', mockNotionPage)
    expect(nodes[0].id).toBe('notion:page-abc-123')
  })

  it('preserves timestamps', async () => {
    const nodes = await adapter.parse('get_page', mockNotionPage)
    expect(nodes[0].createdAt).toBe('2024-01-15T10:00:00Z')
    expect(nodes[0].updatedAt).toBe('2024-01-20T14:30:00Z')
  })

  it('assigns schema version', async () => {
    const nodes = await adapter.parse('get_page', mockNotionPage)
    expect(nodes[0].schema).toBe('emcp/v1')
  })

  it('returns empty array for unrecognized input', async () => {
    const nodes = await adapter.parse('get_page', { invalid: true })
    expect(nodes).toEqual([])
  })
})
