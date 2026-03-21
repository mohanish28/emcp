#!/usr/bin/env node
/**
 * emcp CLI inspector
 * Usage:
 *   npx emcp inspect <file.json>          — inspect a raw MCP response file
 *   npx emcp inspect --stdin              — read from stdin
 *   npx emcp inspect --tool <name> <file> — specify tool name
 *   npx emcp inspect --xml <file>         — output as XML
 *   npx emcp inspect --pixels <file>      — output pixel manifest only
 *   npx emcp inspect --stats <file>       — show enrichment stats only
 */

import { readFileSync, existsSync } from 'fs'
import { EnhancedMCP } from '../EnhancedMCP.js'
import { SlackAdapter } from '../adapters/slack/index.js'
import { GenericAdapter } from '../adapters/generic/index.js'
import { toXML, toPixelManifest } from '../output/formatters.js'
import type { EnrichedContext } from '../core/types.js'

// ─── ANSI colours ─────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
}

const b = (s: string) => `${C.bold}${s}${C.reset}`
const c = (s: string) => `${C.cyan}${s}${C.reset}`
const g = (s: string) => `${C.green}${s}${C.reset}`
const y = (s: string) => `${C.yellow}${s}${C.reset}`
const r = (s: string) => `${C.red}${s}${C.reset}`
const d = (s: string) => `${C.dim}${s}${C.reset}`

// ─── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const flags = {
    stdin: false,
    xml: false,
    pixels: false,
    stats: false,
    debug: false,
    help: false,
    tool: 'unknown',
    file: '',
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--stdin': flags.stdin = true; break
      case '--xml': flags.xml = true; break
      case '--pixels': flags.pixels = true; break
      case '--stats': flags.stats = true; break
      case '--debug': flags.debug = true; break
      case '--help': case '-h': flags.help = true; break
      case '--tool': flags.tool = args[++i] ?? 'unknown'; break
      case 'inspect': break // subcommand
      default:
        if (!args[i].startsWith('--')) flags.file = args[i]
    }
  }

  return flags
}

// ─── Banner ────────────────────────────────────────────────────────────────────

function printBanner() {
  console.log()
  console.log(`  ${b(c('emcp'))} ${d('inspector')}  ${d('v0.1.0')}`)
  console.log(`  ${d('Enhanced MCP context enrichment')}`)
  console.log()
}

function printHelp() {
  printBanner()
  console.log(`  ${b('Usage')}`)
  console.log(`    ${c('npx emcp inspect')} ${y('<file.json>')}`)
  console.log(`    ${c('cat response.json | npx emcp inspect --stdin')}`)
  console.log()
  console.log(`  ${b('Options')}`)
  console.log(`    ${y('--tool <name>')}   Tool name hint (e.g. figma_get_file)`)
  console.log(`    ${y('--xml')}           Output as XML instead of JSON`)
  console.log(`    ${y('--pixels')}        Output pixel manifest only`)
  console.log(`    ${y('--stats')}         Show enrichment stats summary`)
  console.log(`    ${y('--debug')}         Verbose debug output`)
  console.log(`    ${y('--stdin')}         Read raw MCP response from stdin`)
  console.log()
  console.log(`  ${b('Examples')}`)
  console.log(`    ${d('# Inspect a Figma MCP response')}`)
  console.log(`    ${c('npx emcp inspect figma-response.json --tool figma_get_file')}`)
  console.log()
  console.log(`    ${d('# Get pixel manifest')}`)
  console.log(`    ${c('npx emcp inspect figma-response.json --pixels')}`)
  console.log()
  console.log(`    ${d('# Pipe from an MCP client')}`)
  console.log(`    ${c('mcp-client call figma_get_file | npx emcp inspect --stdin --tool figma_get_file')}`)
  console.log()
}

// ─── Stats printer ─────────────────────────────────────────────────────────────

function printStats(ctx: EnrichedContext) {
  const nodes = Object.values(ctx.nodes)
  const bySource: Record<string, number> = {}
  const byType: Record<string, number> = {}
  const highConf = nodes.filter((n) => n.confidence.overall >= 0.8).length
  const medConf = nodes.filter((n) => n.confidence.overall >= 0.5 && n.confidence.overall < 0.8).length
  const lowConf = nodes.filter((n) => n.confidence.overall < 0.5).length
  const withSpatial = nodes.filter((n) => n.spatial !== undefined).length
  const crossLinked = nodes.filter((n) => (n.linkedNodes?.length ?? 0) > 0).length

  for (const n of nodes) {
    bySource[n.source] = (bySource[n.source] ?? 0) + 1
    byType[n.type] = (byType[n.type] ?? 0) + 1
  }

  printBanner()
  console.log(`  ${b('Enrichment stats')}`)
  console.log()

  // Overview
  console.log(`  ${d('─────────────── overview ───────────────')}`)
  console.log(`  Total nodes        ${b(String(ctx.meta.totalNodes))}`)
  console.log(`  Enrichment time    ${b(ctx.meta.enrichmentMs + 'ms')}`)
  console.log(`  Avg confidence     ${b(String(ctx.meta.averageConfidence))}`)
  console.log(`  Schema             ${d(ctx.schema)}`)
  console.log(`  Sources            ${ctx.sources.map(c).join(', ')}`)
  console.log()

  // Confidence breakdown
  console.log(`  ${d('─────────────── confidence ─────────────')}`)
  console.log(`  ${g('High (≥0.8)')}    ${b(String(highConf))} nodes`)
  console.log(`  ${y('Medium (0.5–0.8)')} ${b(String(medConf))} nodes`)
  console.log(`  ${r('Low (<0.5)')}     ${b(String(lowConf))} nodes`)
  console.log()

  // Spatial
  console.log(`  ${d('─────────────── spatial ────────────────')}`)
  console.log(`  With pixel data    ${b(String(withSpatial))} / ${ctx.meta.totalNodes}`)
  console.log(`  Cross-linked       ${b(String(crossLinked))} nodes`)
  console.log()

  // By source
  console.log(`  ${d('─────────────── by source ──────────────')}`)
  for (const [src, count] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.round((count / ctx.meta.totalNodes) * 20))
    console.log(`  ${c(src.padEnd(16))} ${b(String(count).padStart(4))}  ${d(bar)}`)
  }
  console.log()

  // By type
  console.log(`  ${d('─────────────── by type ────────────────')}`)
  const topTypes = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  for (const [type, count] of topTypes) {
    console.log(`  ${y(type.padEnd(16))} ${b(String(count).padStart(4))}`)
  }
  console.log()

  // Diff (if present)
  if (ctx.diff) {
    console.log(`  ${d('─────────────── diff ───────────────────')}`)
    console.log(`  Added     ${g(String(ctx.diff.added.length))}`)
    console.log(`  Removed   ${r(String(ctx.diff.removed.length))}`)
    console.log(`  Modified  ${y(String(ctx.diff.modified.length))}`)
    console.log()
  }
}

// ─── Tree printer ──────────────────────────────────────────────────────────────

function printTree(ctx: EnrichedContext, maxDepth = 4) {
  printBanner()
  console.log(`  ${b('Node tree')}  ${d(`(${ctx.meta.totalNodes} nodes, ${ctx.sources.join(' + ')})`)}\n`)

  function printNode(id: string, prefix = '', isLast = true) {
    const node = ctx.nodes[id]
    if (!node) return
    if (node.depth > maxDepth) return

    const connector = isLast ? '└─' : '├─'
    const childPrefix = isLast ? '   ' : '│  '

    const confColor = node.confidence.overall >= 0.8 ? g : node.confidence.overall >= 0.5 ? y : r
    const confStr = confColor(`${Math.round(node.confidence.overall * 100)}%`)

    const spatialStr = node.spatial
      ? d(` [${node.spatial.x},${node.spatial.y} ${node.spatial.width}×${node.spatial.height}]`)
      : ''

    const typeStr = y(`[${node.type}]`)
    const nameStr = node.label
      ? `${b(node.name.slice(0, 40))} ${d('"' + node.label.slice(0, 30) + '"')}`
      : b(node.name.slice(0, 50))

    const linkStr = (node.linkedNodes?.length ?? 0) > 0
      ? ` ${c('⇔' + node.linkedNodes!.map((l) => l.source).join(','))}`
      : ''

    console.log(`  ${prefix}${connector} ${typeStr} ${nameStr}${spatialStr} ${confStr}${linkStr}`)

    const children = node.children
    for (let i = 0; i < children.length; i++) {
      const isLastChild = i === children.length - 1
      printNode(children[i], prefix + childPrefix, isLastChild)
    }
  }

  for (let i = 0; i < ctx.rootIds.length; i++) {
    printNode(ctx.rootIds[i], '', i === ctx.rootIds.length - 1)
  }
  console.log()
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const flags = parseArgs()

  if (flags.help) {
    printHelp()
    process.exit(0)
  }

  // Read input
  let raw: string
  if (flags.stdin) {
    raw = readFileSync('/dev/stdin', 'utf8')
  } else if (flags.file) {
    if (!existsSync(flags.file)) {
      console.error(r(`\n  Error: file not found: ${flags.file}\n`))
      process.exit(1)
    }
    raw = readFileSync(flags.file, 'utf8')
  } else {
    printHelp()
    process.exit(1)
  }

  // Parse input
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error(r('\n  Error: invalid JSON input\n'))
    process.exit(1)
  }

  // Build enriched context
  const client = new EnhancedMCP({
    adapters: [new SlackAdapter(), new GenericAdapter()],
    enrichment: 'full',
    debug: flags.debug,
  })

  const ctx = await client.process({
    toolName: flags.tool,
    serverId: flags.tool.split('_')[0] ?? 'unknown',
    content: parsed,
  })

  // Output
  if (flags.stats) {
    printStats(ctx)
    return
  }

  if (flags.pixels) {
    const manifest = toPixelManifest(ctx)
    if (manifest.length === 0) {
      console.log(y('\n  No spatial data found in this response.\n'))
    } else {
      console.log(JSON.stringify(manifest, null, 2))
    }
    return
  }

  if (flags.xml) {
    console.log(toXML(ctx))
    return
  }

  // Default: print tree + stats summary
  printTree(ctx)
  printStats(ctx)
}

main().catch((err: Error) => {
  console.error(r(`\n  Fatal error: ${err.message}\n`))
  process.exit(1)
})
