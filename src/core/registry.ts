import type { EnrichedNode, EnrichedContext } from './types.js'
import { EMCP_SCHEMA_VERSION } from './types.js'

interface LinkedNode {
  nodeId: string
  source: string
  linkType: 'related' | 'mirrors' | 'references' | 'derived'
}

/**
 * ContextRegistry — in-memory store for all enriched nodes across servers.
 * Tracks cross-server links and diffs between snapshots.
 */
export class ContextRegistry {
  private nodes: Map<string, EnrichedNode> = new Map()
  private previousSnapshot: Map<string, EnrichedNode> = new Map()
  private startTime: number = Date.now()

  // ─── Node management ───────────────────────────────────────────────────────

  set(node: EnrichedNode): void {
    this.nodes.set(node.id, node)
  }

  setMany(nodes: EnrichedNode[]): void {
    for (const node of nodes) {
      this.set(node)
    }
  }

  get(id: string): EnrichedNode | undefined {
    return this.nodes.get(id)
  }

  getAll(): EnrichedNode[] {
    return Array.from(this.nodes.values())
  }

  getBySource(source: string): EnrichedNode[] {
    return this.getAll().filter((n) => n.source === source)
  }

  getByType(type: EnrichedNode['type']): EnrichedNode[] {
    return this.getAll().filter((n) => n.type === type)
  }

  has(id: string): boolean {
    return this.nodes.has(id)
  }

  delete(id: string): boolean {
    return this.nodes.delete(id)
  }

  clear(): void {
    this.previousSnapshot = new Map(this.nodes)
    this.nodes.clear()
  }

  size(): number {
    return this.nodes.size
  }

  // ─── Cross-server linking ──────────────────────────────────────────────────

  /**
   * Link two nodes across servers by name similarity or explicit mapping.
   */
  linkNodes(
    nodeIdA: string,
    nodeIdB: string,
    linkType: LinkedNode['linkType'] = 'related'
  ): void {
    const nodeA = this.nodes.get(nodeIdA)
    const nodeB = this.nodes.get(nodeIdB)
    if (!nodeA || !nodeB) return

    const linkAtoB: LinkedNode = {
      nodeId: nodeIdB,
      source: nodeB.source,
      linkType,
    }
    const linkBtoA: LinkedNode = {
      nodeId: nodeIdA,
      source: nodeA.source,
      linkType,
    }

    const existingLinksA = nodeA.linkedNodes ?? []
    const existingLinksB = nodeB.linkedNodes ?? []

    if (!existingLinksA.some((l) => l.nodeId === nodeIdB)) {
      this.nodes.set(nodeIdA, { ...nodeA, linkedNodes: [...existingLinksA, linkAtoB] })
    }
    if (!existingLinksB.some((l) => l.nodeId === nodeIdA)) {
      this.nodes.set(nodeIdB, { ...nodeB, linkedNodes: [...existingLinksB, linkBtoA] })
    }
  }

  /**
   * Auto-link nodes across servers that share the same name.
   */
  autoLink(): number {
    const allNodes = this.getAll()
    const nameMap: Map<string, EnrichedNode[]> = new Map()
    let linkCount = 0

    for (const node of allNodes) {
      const key = node.name.toLowerCase().trim()
      const existing = nameMap.get(key) ?? []
      nameMap.set(key, [...existing, node])
    }

    for (const [, group] of nameMap) {
      if (group.length < 2) continue
      const crossServer = group.filter(
        (n, i) => group.findIndex((m) => m.source !== n.source) !== -1 && i === 0
          ? true
          : group.slice(0, i).every((m) => m.source === n.source) === false
      )
      if (crossServer.length < 2) continue

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (group[i].source !== group[j].source) {
            this.linkNodes(group[i].id, group[j].id, 'related')
            linkCount++
          }
        }
      }
    }

    return linkCount
  }

  // ─── Diff tracking ─────────────────────────────────────────────────────────

  snapshot(): void {
    this.previousSnapshot = new Map(this.nodes)
  }

  diff(): { added: string[]; removed: string[]; modified: string[] } {
    const added: string[] = []
    const removed: string[] = []
    const modified: string[] = []

    for (const [id, node] of this.nodes) {
      if (!this.previousSnapshot.has(id)) {
        added.push(id)
      } else {
        const prev = this.previousSnapshot.get(id)!
        if (JSON.stringify(prev) !== JSON.stringify(node)) {
          modified.push(id)
        }
      }
    }

    for (const id of this.previousSnapshot.keys()) {
      if (!this.nodes.has(id)) {
        removed.push(id)
      }
    }

    return { added, removed, modified }
  }

  // ─── Build final context output ────────────────────────────────────────────

  build(includeDiff = false): EnrichedContext {
    const allNodes = this.getAll()
    const sources = [...new Set(allNodes.map((n) => n.source))]
    const rootIds = allNodes.filter((n) => !n.parentId).map((n) => n.id)

    const totalConfidence = allNodes.reduce((sum, n) => sum + n.confidence.overall, 0)
    const averageConfidence = allNodes.length > 0 ? totalConfidence / allNodes.length : 0

    const nodesRecord: Record<string, EnrichedNode> = {}
    for (const node of allNodes) {
      nodesRecord[node.id] = node
    }

    return {
      schema: EMCP_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      sources,
      nodes: nodesRecord,
      rootIds,
      diff: includeDiff ? this.diff() : undefined,
      meta: {
        totalNodes: allNodes.length,
        enrichmentMs: Date.now() - this.startTime,
        averageConfidence: Math.round(averageConfidence * 100) / 100,
      },
    }
  }

  resetTimer(): void {
    this.startTime = Date.now()
  }
}
