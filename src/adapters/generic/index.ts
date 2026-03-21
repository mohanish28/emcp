import { z } from 'zod'
import type { EMCPAdapter, EnrichedNode } from '../../core/types.js'
import { EMCP_SCHEMA_VERSION } from '../../core/types.js'
import { SemanticTagger } from '../../enrichment/tagger.js'
import { ConfidenceScorer } from '../../enrichment/scorer.js'

// Generic content block from any MCP server
const GenericContentSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('resource'), resource: z.object({ uri: z.string(), text: z.string().optional(), mimeType: z.string().optional() }) }),
  z.object({ type: z.string() }).passthrough(),
])

const MCPToolResultSchema = z.object({
  content: z.array(GenericContentSchema).optional(),
  isError: z.boolean().optional(),
  _meta: z.record(z.unknown()).optional(),
})

// ─── Generic Adapter ───────────────────────────────────────────────────────────

export class GenericAdapter implements EMCPAdapter {
  readonly name = 'generic'
  readonly version = '1.0.0'

  private tagger = new SemanticTagger()
  private scorer = new ConfidenceScorer()

  // Always handles — this is the fallback
  canHandle(_toolName: string, _response: unknown): boolean {
    return true
  }

  async parse(toolName: string, response: unknown): Promise<EnrichedNode[]> {
    const nodes: EnrichedNode[] = []

    // Try MCP standard tool result shape
    const mcpResult = MCPToolResultSchema.safeParse(response)
    if (mcpResult.success && mcpResult.data.content) {
      for (let i = 0; i < mcpResult.data.content.length; i++) {
        const block = mcpResult.data.content[i]
        const node = this.parseContentBlock(block, toolName, i)
        if (node) nodes.push(node)
      }
      return nodes
    }

    // Try array of objects
    if (Array.isArray(response)) {
      for (let i = 0; i < response.length; i++) {
        const node = this.parseArbitraryObject(response[i], toolName, i, undefined, 0)
        if (node) nodes.push(node)
      }
      return nodes
    }

    // Try single object
    if (response && typeof response === 'object') {
      const node = this.parseArbitraryObject(response, toolName, 0, undefined, 0)
      if (node) nodes.push(node)
    }

    return nodes
  }

  private parseContentBlock(
    block: unknown,
    toolName: string,
    index: number
  ): EnrichedNode | null {
    if (!block || typeof block !== 'object') return null
    const b = block as Record<string, unknown>

    const text = typeof b['text'] === 'string' ? b['text'] : JSON.stringify(b)
    const tagged = this.tagger.tag(text.slice(0, 60) || toolName)

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.4,
      styleFromApi: false,
      hasChildren: false,
      hasParent: false,
    })

    return {
      id: `generic:${toolName}:${index}`,
      name: text.slice(0, 60) || toolName,
      schema: EMCP_SCHEMA_VERSION,
      source: toolName,
      type: tagged.type,
      role: tagged.role,
      label: text.slice(0, 500) || undefined,
      parentId: undefined,
      children: [],
      depth: 0,
      confidence,
      raw: b,
    }
  }

  private parseArbitraryObject(
    obj: unknown,
    toolName: string,
    index: number,
    parentId: string | undefined,
    depth: number
  ): EnrichedNode | null {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
    const o = obj as Record<string, unknown>

    // Extract common identifier fields
    const id = String(o['id'] ?? o['_id'] ?? o['key'] ?? o['uuid'] ?? `${toolName}:${index}`)
    const name = String(o['name'] ?? o['title'] ?? o['label'] ?? o['text'] ?? id).slice(0, 100)
    const text = typeof o['text'] === 'string' ? o['text']
      : typeof o['description'] === 'string' ? o['description']
      : typeof o['content'] === 'string' ? o['content']
      : undefined

    // Detect spatial fields
    const hasX = typeof o['x'] === 'number'
    const hasY = typeof o['y'] === 'number'
    const hasW = typeof o['width'] === 'number' || typeof o['w'] === 'number'
    const hasH = typeof o['height'] === 'number' || typeof o['h'] === 'number'
    const hasSpatial = hasX && hasY && (hasW || hasH)

    const tagged = this.tagger.tag(name, String(o['type'] ?? ''))

    const confidence = this.scorer.score({
      spatialFromApi: hasSpatial,
      semanticScore: tagged.confidence * 0.7, // lower confidence for generic
      styleFromApi: false,
      hasChildren: Array.isArray(o['children']) && (o['children'] as unknown[]).length > 0,
      hasParent: parentId !== undefined,
    })

    const nodeId = `generic:${id}`

    const node: EnrichedNode = {
      id: nodeId,
      name,
      schema: EMCP_SCHEMA_VERSION,
      source: toolName,
      sourceId: id,
      type: tagged.type,
      role: tagged.role,
      label: text?.slice(0, 500),
      parentId,
      children: [],
      depth,
      confidence,
      spatial: hasSpatial
        ? {
            x: Number(o['x'] ?? 0),
            y: Number(o['y'] ?? 0),
            width: Number(o['width'] ?? o['w'] ?? 0),
            height: Number(o['height'] ?? o['h'] ?? 0),
          }
        : undefined,
      raw: o,
    }

    // Recurse into children
    if (Array.isArray(o['children'])) {
      for (let i = 0; i < (o['children'] as unknown[]).length; i++) {
        const child = this.parseArbitraryObject(
          (o['children'] as unknown[])[i],
          toolName,
          i,
          nodeId,
          depth + 1
        )
        if (child) {
          node.children.push(child.id)
        }
      }
    }

    return node
  }

}
