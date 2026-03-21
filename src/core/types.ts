import { z } from 'zod'

// ─── Schema version ───────────────────────────────────────────────────────────
export const EMCP_SCHEMA_VERSION = 'emcp/v1' as const

// ─── Spatial data ─────────────────────────────────────────────────────────────
export const SpatialSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  zIndex: z.number().optional(),
  rotation: z.number().optional(),
  constraints: z
    .object({
      horizontal: z.enum(['left', 'right', 'center', 'stretch', 'scale']).optional(),
      vertical: z.enum(['top', 'bottom', 'center', 'stretch', 'scale']).optional(),
    })
    .optional(),
})
export type Spatial = z.infer<typeof SpatialSchema>

// ─── Visual style ─────────────────────────────────────────────────────────────
export const StyleSchema = z.object({
  fill: z.string().optional(),           // hex color e.g. "#0D99FF"
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  borderRadius: z.number().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.union([z.number(), z.string()]).optional(),
  lineHeight: z.number().optional(),
  textAlign: z.enum(['left', 'center', 'right', 'justify']).optional(),
  textColor: z.string().optional(),
})
export type Style = z.infer<typeof StyleSchema>

// ─── Semantic node types ───────────────────────────────────────────────────────
export const SemanticTypeSchema = z.enum([
  // UI components
  'FRAME', 'COMPONENT', 'INSTANCE', 'GROUP',
  'BUTTON', 'INPUT', 'TEXT', 'IMAGE', 'ICON', 'LINK',
  'CARD', 'MODAL', 'NAVBAR', 'SIDEBAR', 'TABLE', 'LIST',
  // Document
  'PAGE', 'SECTION', 'HEADING', 'PARAGRAPH', 'BLOCK',
  'DATABASE', 'ROW', 'COLUMN', 'CELL',
  // Generic
  'CONTAINER', 'UNKNOWN',
])
export type SemanticType = z.infer<typeof SemanticTypeSchema>

// ─── Confidence scores ─────────────────────────────────────────────────────────
export const ConfidenceSchema = z.object({
  spatial: z.number().min(0).max(1),    // 0.99 = from API, 0.4 = inferred
  semantic: z.number().min(0).max(1),   // confidence in type classification
  style: z.number().min(0).max(1),
  overall: z.number().min(0).max(1),
})
export type Confidence = z.infer<typeof ConfidenceSchema>

// ─── Enriched node — the core output unit ─────────────────────────────────────
export const EnrichedNodeSchema = z.object({
  // Identity
  id: z.string(),
  name: z.string(),
  schema: z.literal(EMCP_SCHEMA_VERSION),
  source: z.string(),                   // e.g. "figma", "notion"
  sourceId: z.string().optional(),      // original ID in source system

  // Semantic
  type: SemanticTypeSchema,
  role: z.enum(['primary', 'secondary', 'tertiary', 'decorative', 'structural', 'unknown']),
  label: z.string().optional(),         // visible text content
  description: z.string().optional(),   // alt text / aria-label / caption

  // Spatial (optional — not all sources have this)
  spatial: SpatialSchema.optional(),

  // Style
  style: StyleSchema.optional(),

  // Tree structure
  parentId: z.string().optional(),
  children: z.array(z.string()),        // array of child IDs
  depth: z.number(),                    // nesting depth from root

  // Confidence
  confidence: ConfidenceSchema,

  // Cross-server links
  linkedNodes: z
    .array(
      z.object({
        nodeId: z.string(),
        source: z.string(),
        linkType: z.enum(['related', 'mirrors', 'references', 'derived']),
      })
    )
    .optional(),

  // Raw passthrough
  raw: z.record(z.unknown()).optional(),

  // Metadata
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})
export type EnrichedNode = z.infer<typeof EnrichedNodeSchema>

// ─── Enriched context — what the LLM receives ─────────────────────────────────
export const EnrichedContextSchema = z.object({
  schema: z.literal(EMCP_SCHEMA_VERSION),
  timestamp: z.string(),
  sources: z.array(z.string()),
  nodes: z.record(EnrichedNodeSchema),  // keyed by node ID
  rootIds: z.array(z.string()),         // top-level node IDs
  diff: z
    .object({
      added: z.array(z.string()),
      removed: z.array(z.string()),
      modified: z.array(z.string()),
    })
    .optional(),
  meta: z.object({
    totalNodes: z.number(),
    enrichmentMs: z.number(),
    averageConfidence: z.number(),
  }),
})
export type EnrichedContext = z.infer<typeof EnrichedContextSchema>

// ─── Adapter interface ─────────────────────────────────────────────────────────
export interface EMCPAdapter {
  readonly name: string
  readonly version: string
  canHandle(toolName: string, response: unknown): boolean
  parse(toolName: string, response: unknown): Promise<EnrichedNode[]>
}

// ─── Config ───────────────────────────────────────────────────────────────────
export interface EMCPConfig {
  adapters?: EMCPAdapter[]
  enrichment?: 'minimal' | 'standard' | 'full'
  output?: 'json' | 'xml' | 'both'
  diffTracking?: boolean
  debug?: boolean
}

// ─── Tool response (raw MCP) ──────────────────────────────────────────────────
export interface RawToolResponse {
  toolName: string
  serverId: string
  content: unknown
  isError?: boolean
}
