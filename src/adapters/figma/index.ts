import { z } from 'zod'
import type { EMCPAdapter, EnrichedNode } from '../../core/types.js'
import { EMCP_SCHEMA_VERSION } from '../../core/types.js'
import { SemanticTagger } from '../../enrichment/tagger.js'
import { ConfidenceScorer } from '../../enrichment/scorer.js'

// ─── Figma API node shapes ─────────────────────────────────────────────────────

const FigmaColorSchema = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number().optional(),
})

const FigmaBoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})

const FigmaNodeSchema: z.ZodType<FigmaNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    visible: z.boolean().optional(),
    absoluteBoundingBox: FigmaBoundingBoxSchema.optional(),
    absoluteRenderBounds: FigmaBoundingBoxSchema.optional(),
    constraints: z
      .object({
        horizontal: z.string().optional(),
        vertical: z.string().optional(),
      })
      .optional(),
    fills: z
      .array(
        z.object({
          type: z.string(),
          color: FigmaColorSchema.optional(),
          opacity: z.number().optional(),
        })
      )
      .optional(),
    strokes: z
      .array(
        z.object({
          type: z.string(),
          color: FigmaColorSchema.optional(),
        })
      )
      .optional(),
    strokeWeight: z.number().optional(),
    opacity: z.number().optional(),
    cornerRadius: z.number().optional(),
    style: z
      .object({
        fontFamily: z.string().optional(),
        fontSize: z.number().optional(),
        fontWeight: z.number().optional(),
        lineHeightPx: z.number().optional(),
        textAlignHorizontal: z.string().optional(),
      })
      .optional(),
    characters: z.string().optional(),    // text content
    children: z.array(z.lazy(() => FigmaNodeSchema)).optional(),
    componentId: z.string().optional(),
    description: z.string().optional(),
    rotation: z.number().optional(),
  })
)

interface FigmaNode {
  id: string
  name: string
  type: string
  visible?: boolean
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number }
  absoluteRenderBounds?: { x: number; y: number; width: number; height: number }
  constraints?: { horizontal?: string; vertical?: string }
  fills?: Array<{ type: string; color?: { r: number; g: number; b: number; a?: number }; opacity?: number }>
  strokes?: Array<{ type: string; color?: { r: number; g: number; b: number; a?: number } }>
  strokeWeight?: number
  opacity?: number
  cornerRadius?: number
  style?: {
    fontFamily?: string
    fontSize?: number
    fontWeight?: number
    lineHeightPx?: number
    textAlignHorizontal?: string
  }
  characters?: string
  children?: FigmaNode[]
  componentId?: string
  description?: string
  rotation?: number
}

// ─── Response wrapper shapes ───────────────────────────────────────────────────

const FigmaGetFileResponseSchema = z.object({
  document: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    children: z.array(z.unknown()),
  }),
  name: z.string().optional(),
})

const FigmaGetNodeResponseSchema = z.object({
  nodes: z.record(
    z.object({
      document: z.unknown(),
    })
  ),
})

// ─── Colour utils ──────────────────────────────────────────────────────────────

function rgbaToHex(r: number, g: number, b: number, a = 1): string {
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  const base = `#${toHex(r)}${toHex(g)}${toHex(b)}`
  return a < 1 ? `${base}${toHex(a)}` : base
}

function extractFill(fills?: FigmaNode['fills']): string | undefined {
  if (!fills || fills.length === 0) return undefined
  const solidFill = fills.find((f) => f.type === 'SOLID' && f.color)
  if (!solidFill?.color) return undefined
  const { r, g, b, a } = solidFill.color
  return rgbaToHex(r, g, b, a)
}

function extractTextAlign(
  align?: string
): 'left' | 'center' | 'right' | 'justify' | undefined {
  if (!align) return undefined
  const map: Record<string, 'left' | 'center' | 'right' | 'justify'> = {
    LEFT: 'left',
    CENTER: 'center',
    RIGHT: 'right',
    JUSTIFIED: 'justify',
  }
  return map[align]
}

// ─── Figma Adapter ─────────────────────────────────────────────────────────────

export class FigmaAdapter implements EMCPAdapter {
  readonly name = 'figma'
  readonly version = '1.0.0'

  private tagger = new SemanticTagger()
  private scorer = new ConfidenceScorer()

  canHandle(toolName: string, _response: unknown): boolean {
    return (
      toolName.includes('figma') ||
      toolName.includes('get_file') ||
      toolName.includes('get_node') ||
      toolName.includes('get_component') ||
      toolName.includes('get_frame')
    )
  }

  async parse(_toolName: string, response: unknown): Promise<EnrichedNode[]> {
    const nodes: EnrichedNode[] = []

    // Try file response
    const fileResult = FigmaGetFileResponseSchema.safeParse(response)
    if (fileResult.success) {
      const rawChildren = fileResult.data.document.children
      for (const child of rawChildren) {
        const parsed = FigmaNodeSchema.safeParse(child)
        if (parsed.success) {
          this.flattenNode(parsed.data, undefined, 0, nodes)
        }
      }
      return nodes
    }

    // Try node response
    const nodeResult = FigmaGetNodeResponseSchema.safeParse(response)
    if (nodeResult.success) {
      for (const [, entry] of Object.entries(nodeResult.data.nodes)) {
        const parsed = FigmaNodeSchema.safeParse(entry.document)
        if (parsed.success) {
          this.flattenNode(parsed.data, undefined, 0, nodes)
        }
      }
      return nodes
    }

    // Try direct node
    const directResult = FigmaNodeSchema.safeParse(response)
    if (directResult.success) {
      this.flattenNode(directResult.data, undefined, 0, nodes)
      return nodes
    }

    return nodes
  }

  private flattenNode(
    node: FigmaNode,
    parentId: string | undefined,
    depth: number,
    out: EnrichedNode[]
  ): void {
    const bbox = node.absoluteBoundingBox
    const tagged = this.tagger.tag(node.name, node.type)
    const fill = extractFill(node.fills)

    const confidence = this.scorer.score({
      spatialFromApi: !!bbox,
      semanticScore: tagged.confidence,
      styleFromApi: true,
      hasChildren: (node.children?.length ?? 0) > 0,
      hasParent: parentId !== undefined,
    })

    const enriched: EnrichedNode = {
      id: node.id,
      name: node.name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'figma',
      sourceId: node.id,
      type: tagged.type,
      role: tagged.role,
      label: node.characters ?? undefined,
      description: node.description ?? undefined,

      spatial: bbox
        ? {
            x: Math.round(bbox.x),
            y: Math.round(bbox.y),
            width: Math.round(bbox.width),
            height: Math.round(bbox.height),
            rotation: node.rotation,
            constraints: node.constraints
              ? {
                  horizontal: node.constraints.horizontal as EnrichedNode['spatial'] extends infer S
                    ? S extends { constraints?: { horizontal?: infer H } }
                      ? H
                      : never
                    : never,
                  vertical: node.constraints.vertical as EnrichedNode['spatial'] extends infer S
                    ? S extends { constraints?: { vertical?: infer V } }
                      ? V
                      : never
                    : never,
                }
              : undefined,
          }
        : undefined,

      style: {
        fill,
        strokeWidth: node.strokeWeight,
        opacity: node.opacity,
        borderRadius: node.cornerRadius,
        fontFamily: node.style?.fontFamily,
        fontSize: node.style?.fontSize,
        fontWeight: node.style?.fontWeight,
        lineHeight: node.style?.lineHeightPx,
        textAlign: extractTextAlign(node.style?.textAlignHorizontal),
      },

      parentId,
      children: (node.children ?? []).map((c) => c.id),
      depth,
      confidence,

      raw: node as unknown as Record<string, unknown>,
    }

    out.push(enriched)

    for (const child of node.children ?? []) {
      this.flattenNode(child, node.id, depth + 1, out)
    }
  }
}
