// Main class
export { EnhancedMCP } from './EnhancedMCP.js'

// Core types
export type {
  EnrichedNode,
  EnrichedContext,
  Spatial,
  Style,
  Confidence,
  SemanticType,
  EMCPAdapter,
  EMCPConfig,
  RawToolResponse,
} from './core/types.js'

export { EMCP_SCHEMA_VERSION } from './core/types.js'

// Registry
export { ContextRegistry } from './core/registry.js'

// Built-in adapters
export { FigmaAdapter } from './adapters/figma/index.js'
export { NotionAdapter } from './adapters/notion/index.js'
export { SlackAdapter } from './adapters/slack/index.js'
export { AsanaAdapter } from './adapters/asana/index.js'
export { GitHubAdapter } from './adapters/github/index.js'
export { SalesforceAdapter } from './adapters/salesforce/index.js'
export { LinearAdapter } from './adapters/linear/index.js'
export { GenericAdapter } from './adapters/generic/index.js'

// Enrichment
export { SemanticTagger } from './enrichment/tagger.js'
export { ConfidenceScorer } from './enrichment/scorer.js'

// Output
export { toJSON, toXML, toPixelManifest } from './output/formatters.js'
export type { PixelManifestEntry } from './output/formatters.js'
