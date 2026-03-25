import type { EMCPAdapter, EMCPConfig, EnrichedContext, RawToolResponse } from './core/types.js'
import { ContextRegistry } from './core/registry.js'
import { FigmaAdapter } from './adapters/figma/index.js'
import { NotionAdapter } from './adapters/notion/index.js'
import { SlackAdapter } from './adapters/slack/index.js'
import { AsanaAdapter } from './adapters/asana/index.js'
import { GitHubAdapter } from './adapters/github/index.js'
import { SalesforceAdapter } from './adapters/salesforce/index.js'
import { LinearAdapter } from './adapters/linear/index.js'
import { GenericAdapter } from './adapters/generic/index.js'
import { toJSON, toXML, toPixelManifest } from './output/formatters.js'
import type { PixelManifestEntry } from './output/formatters.js'

export class EnhancedMCP {
  private adapters: EMCPAdapter[]
  private registry: ContextRegistry
  private config: Required<EMCPConfig>

  constructor(config: EMCPConfig = {}) {
    this.config = {
      adapters: config.adapters ?? [],
      enrichment: config.enrichment ?? 'standard',
      output: config.output ?? 'json',
      diffTracking: config.diffTracking ?? false,
      debug: config.debug ?? false,
    }

    // Built-in adapters + user-provided adapters (user adapters registered via registerAdapter get priority)
    this.adapters = [
      new FigmaAdapter(),
      new NotionAdapter(),
      new SlackAdapter(),
      new AsanaAdapter(),
      new GitHubAdapter(),
      new SalesforceAdapter(),
      new LinearAdapter(),
      new GenericAdapter(),   // always last — fallback for unknown servers
      ...this.config.adapters,
    ]

    this.registry = new ContextRegistry()
  }

  // ─── Core: process a raw MCP tool response ─────────────────────────────────

  async process(response: RawToolResponse): Promise<EnrichedContext> {
    this.registry.resetTimer()

    if (this.config.diffTracking) {
      this.registry.snapshot()
    }

    const adapter = this.findAdapter(response.toolName, response.content)

    if (adapter) {
      this.log(`Using adapter: ${adapter.name} for tool: ${response.toolName}`)
      const nodes = await adapter.parse(response.toolName, response.content)
      this.registry.setMany(nodes)
      this.log(`Parsed ${nodes.length} nodes`)
    } else {
      this.log(`No adapter found for tool: ${response.toolName}`)
    }

    return this.registry.build(this.config.diffTracking)
  }

  // ─── Batch: process multiple responses ─────────────────────────────────────

  async processMany(responses: RawToolResponse[]): Promise<EnrichedContext> {
    this.registry.resetTimer()

    if (this.config.diffTracking) {
      this.registry.snapshot()
    }

    for (const response of responses) {
      const adapter = this.findAdapter(response.toolName, response.content)
      if (adapter) {
        const nodes = await adapter.parse(response.toolName, response.content)
        this.registry.setMany(nodes)
      }
    }

    // Auto-link cross-server nodes by name
    const linkCount = this.registry.autoLink()
    this.log(`Auto-linked ${linkCount} cross-server node pairs`)

    return this.registry.build(this.config.diffTracking)
  }

  // ─── Get context in various formats ────────────────────────────────────────

  async getContext(): Promise<EnrichedContext> {
    return this.registry.build(this.config.diffTracking)
  }

  async getJSON(pretty = false): Promise<string> {
    const ctx = await this.getContext()
    return toJSON(ctx, pretty)
  }

  async getXML(): Promise<string> {
    const ctx = await this.getContext()
    return toXML(ctx)
  }

  async getPixelManifest(): Promise<PixelManifestEntry[]> {
    const ctx = await this.getContext()
    return toPixelManifest(ctx)
  }

  // ─── Registry access ───────────────────────────────────────────────────────

  getRegistry(): ContextRegistry {
    return this.registry
  }

  clearContext(): void {
    this.registry.clear()
  }

  linkNodes(
    nodeIdA: string,
    nodeIdB: string,
    linkType: 'related' | 'mirrors' | 'references' | 'derived' = 'related'
  ): void {
    this.registry.linkNodes(nodeIdA, nodeIdB, linkType)
  }

  // ─── Adapter management ────────────────────────────────────────────────────

  registerAdapter(adapter: EMCPAdapter): void {
    this.adapters.unshift(adapter) // user adapters take priority
  }

  private findAdapter(toolName: string, response: unknown): EMCPAdapter | undefined {
    return this.adapters.find((a) => a.canHandle(toolName, response))
  }

  // ─── Debug ─────────────────────────────────────────────────────────────────

  private log(msg: string): void {
    if (this.config.debug) {
      console.log(`[emcp] ${msg}`)
    }
  }
}
