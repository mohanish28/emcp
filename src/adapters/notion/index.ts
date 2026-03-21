import { z } from 'zod'
import type { EMCPAdapter, EnrichedNode } from '../../core/types.js'
import { EMCP_SCHEMA_VERSION } from '../../core/types.js'
import { SemanticTagger } from '../../enrichment/tagger.js'
import { ConfidenceScorer } from '../../enrichment/scorer.js'

// ─── Notion API shapes ─────────────────────────────────────────────────────────

const NotionRichTextSchema = z.object({
  plain_text: z.string(),
  href: z.string().nullable().optional(),
})

const NotionPropertySchema = z.union([
  z.object({ type: z.literal('title'), title: z.array(NotionRichTextSchema) }),
  z.object({ type: z.literal('rich_text'), rich_text: z.array(NotionRichTextSchema) }),
  z.object({ type: z.literal('number'), number: z.number().nullable() }),
  z.object({ type: z.literal('select'), select: z.object({ name: z.string() }).nullable() }),
  z.object({ type: z.literal('multi_select'), multi_select: z.array(z.object({ name: z.string() })) }),
  z.object({ type: z.literal('checkbox'), checkbox: z.boolean() }),
  z.object({ type: z.literal('date'), date: z.object({ start: z.string() }).nullable() }),
  z.object({ type: z.literal('url'), url: z.string().nullable() }),
  z.object({ type: z.literal('email'), email: z.string().nullable() }),
  z.object({ type: z.literal('files'), files: z.array(z.unknown()) }),
  z.object({ type: z.string() }).passthrough(),
])

const NotionPageSchema = z.object({
  id: z.string(),
  object: z.literal('page'),
  url: z.string().optional(),
  created_time: z.string().optional(),
  last_edited_time: z.string().optional(),
  properties: z.record(NotionPropertySchema).optional(),
  parent: z
    .union([
      z.object({ type: z.literal('database_id'), database_id: z.string() }),
      z.object({ type: z.literal('page_id'), page_id: z.string() }),
      z.object({ type: z.literal('workspace'), workspace: z.literal(true) }),
    ])
    .optional(),
})

const NotionBlockSchema = z.object({
  id: z.string(),
  object: z.literal('block'),
  type: z.string(),
  created_time: z.string().optional(),
  last_edited_time: z.string().optional(),
  has_children: z.boolean().optional(),
  paragraph: z.object({ rich_text: z.array(NotionRichTextSchema) }).optional(),
  heading_1: z.object({ rich_text: z.array(NotionRichTextSchema) }).optional(),
  heading_2: z.object({ rich_text: z.array(NotionRichTextSchema) }).optional(),
  heading_3: z.object({ rich_text: z.array(NotionRichTextSchema) }).optional(),
  bulleted_list_item: z.object({ rich_text: z.array(NotionRichTextSchema) }).optional(),
  numbered_list_item: z.object({ rich_text: z.array(NotionRichTextSchema) }).optional(),
  to_do: z.object({ rich_text: z.array(NotionRichTextSchema), checked: z.boolean() }).optional(),
  toggle: z.object({ rich_text: z.array(NotionRichTextSchema) }).optional(),
  callout: z.object({ rich_text: z.array(NotionRichTextSchema) }).optional(),
  quote: z.object({ rich_text: z.array(NotionRichTextSchema) }).optional(),
  code: z.object({ rich_text: z.array(NotionRichTextSchema), language: z.string() }).optional(),
  image: z.object({ type: z.string(), external: z.object({ url: z.string() }).optional() }).optional(),
})

const NotionDatabaseSchema = z.object({
  id: z.string(),
  object: z.literal('database'),
  title: z.array(NotionRichTextSchema).optional(),
  url: z.string().optional(),
  created_time: z.string().optional(),
  last_edited_time: z.string().optional(),
  properties: z.record(z.object({ type: z.string(), id: z.string() })).optional(),
})

const NotionListResponseSchema = z.object({
  results: z.array(z.unknown()),
  has_more: z.boolean().optional(),
  next_cursor: z.string().nullable().optional(),
})

type NotionPage = z.infer<typeof NotionPageSchema>
type NotionBlock = z.infer<typeof NotionBlockSchema>
type NotionDatabase = z.infer<typeof NotionDatabaseSchema>

// ─── Helpers ───────────────────────────────────────────────────────────────────

function extractPlainText(richText: Array<{ plain_text: string }>): string {
  return richText.map((rt) => rt.plain_text).join('')
}

function getPageTitle(page: NotionPage): string {
  if (!page.properties) return page.id
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'title' && 'title' in prop) {
      const title = extractPlainText(prop.title)
      if (title) return title
    }
  }
  return page.id
}

function getBlockText(block: NotionBlock): string | undefined {
  const textFields: Array<keyof NotionBlock> = [
    'paragraph', 'heading_1', 'heading_2', 'heading_3',
    'bulleted_list_item', 'numbered_list_item', 'to_do',
    'toggle', 'callout', 'quote',
  ]
  for (const field of textFields) {
    const val = block[field]
    if (val && typeof val === 'object' && 'rich_text' in val) {
      return extractPlainText((val as { rich_text: Array<{ plain_text: string }> }).rich_text)
    }
  }
  return undefined
}

// ─── Notion Adapter ────────────────────────────────────────────────────────────

export class NotionAdapter implements EMCPAdapter {
  readonly name = 'notion'
  readonly version = '1.0.0'

  private tagger = new SemanticTagger()
  private scorer = new ConfidenceScorer()

  canHandle(toolName: string, _response: unknown): boolean {
    return (
      toolName.includes('notion') ||
      toolName.includes('get_page') ||
      toolName.includes('get_block') ||
      toolName.includes('query_database') ||
      toolName.includes('search_notion') ||
      toolName.includes('notion-fetch') ||
      toolName.includes('notion-search')
    )
  }

  async parse(_toolName: string, response: unknown): Promise<EnrichedNode[]> {
    const nodes: EnrichedNode[] = []

    // List response (database query, search)
    const listResult = NotionListResponseSchema.safeParse(response)
    if (listResult.success) {
      for (const item of listResult.data.results) {
        const parsed = this.parseItem(item, undefined, 0)
        if (parsed) nodes.push(...parsed)
      }
      return nodes
    }

    // Single item
    const parsed = this.parseItem(response, undefined, 0)
    if (parsed) nodes.push(...parsed)
    return nodes
  }

  private parseItem(
    item: unknown,
    parentId: string | undefined,
    depth: number
  ): EnrichedNode[] | null {
    const pageResult = NotionPageSchema.safeParse(item)
    if (pageResult.success) return [this.parsePage(pageResult.data, parentId, depth)]

    const blockResult = NotionBlockSchema.safeParse(item)
    if (blockResult.success) return [this.parseBlock(blockResult.data, parentId, depth)]

    const dbResult = NotionDatabaseSchema.safeParse(item)
    if (dbResult.success) return [this.parseDatabase(dbResult.data, parentId, depth)]

    return null
  }

  private parsePage(page: NotionPage, parentId: string | undefined, depth: number): EnrichedNode {
    const title = getPageTitle(page)
    const tagged = this.tagger.tag(title, 'PAGE')
    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: tagged.confidence,
      styleFromApi: false,
      hasChildren: true,
      hasParent: parentId !== undefined,
    })

    return {
      id: `notion:${page.id}`,
      name: title,
      schema: EMCP_SCHEMA_VERSION,
      source: 'notion',
      sourceId: page.id,
      type: 'PAGE',
      role: 'structural',
      label: title,
      parentId,
      children: [],
      depth,
      confidence,
      createdAt: page.created_time,
      updatedAt: page.last_edited_time,
      raw: page as unknown as Record<string, unknown>,
    }
  }

  private parseBlock(block: NotionBlock, parentId: string | undefined, depth: number): EnrichedNode {
    const text = getBlockText(block) ?? ''
    const tagged = this.tagger.tag(text || block.type, block.type.toUpperCase())
    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: tagged.confidence,
      styleFromApi: false,
      hasChildren: block.has_children ?? false,
      hasParent: parentId !== undefined,
    })

    return {
      id: `notion:${block.id}`,
      name: text || block.type,
      schema: EMCP_SCHEMA_VERSION,
      source: 'notion',
      sourceId: block.id,
      type: tagged.type,
      role: tagged.role,
      label: text || undefined,
      parentId,
      children: [],
      depth,
      confidence,
      createdAt: block.created_time,
      updatedAt: block.last_edited_time,
      raw: block as unknown as Record<string, unknown>,
    }
  }

  private parseDatabase(db: NotionDatabase, parentId: string | undefined, depth: number): EnrichedNode {
    const title = db.title ? extractPlainText(db.title) : db.id
    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.9,
      styleFromApi: false,
      hasChildren: true,
      hasParent: parentId !== undefined,
    })

    return {
      id: `notion:${db.id}`,
      name: title,
      schema: EMCP_SCHEMA_VERSION,
      source: 'notion',
      sourceId: db.id,
      type: 'DATABASE',
      role: 'structural',
      label: title,
      parentId,
      children: [],
      depth,
      confidence,
      createdAt: db.created_time,
      updatedAt: db.last_edited_time,
      raw: db as unknown as Record<string, unknown>,
    }
  }
}
