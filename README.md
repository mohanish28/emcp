# emcp

**Enhanced MCP** — a TypeScript package that wraps any MCP server and outputs enriched, typed, pixel-accurate, cross-server context for LLMs.

[![CI](https://github.com/mohanish28/emcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mohanish28/emcp/actions)
[![npm version](https://img.shields.io/npm/v/@odin_ssup/emcp)](https://www.npmjs.com/package/@odin_ssup/emcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## The problem

When you connect an MCP server (Figma, Notion, Slack) to an LLM, the model receives unstructured prose:

```
"Frame 'Dashboard' contains a button labeled Submit, blue color, top right area"
```

No coordinates. No hex values. No parent-child tree. The LLM has to guess — and it gets it wrong.

## The solution

`emcp` intercepts raw MCP responses and outputs this:

```json
{
  "id": "btn-submit",
  "type": "BUTTON",
  "label": "Submit",
  "source": "figma",
  "spatial": { "x": 1142, "y": 48, "width": 120, "height": 40 },
  "style": { "fill": "#0D99FF", "borderRadius": 8 },
  "parentId": "frame-dashboard",
  "confidence": { "spatial": 0.99, "semantic": 0.95, "overall": 0.97 },
  "schema": "emcp/v1"
}
```

Pixel-accurate. Typed. Versioned. Cross-server linked.

---

## Install

```bash
npm install @odin_ssup/emcp
```

---

## Quick start

```typescript
import { EnhancedMCP } from '@odin_ssup/emcp'

const client = new EnhancedMCP({
  enrichment: 'full',
  output: 'json',
})

// Wrap any raw MCP tool response
const ctx = await client.process({
  toolName: 'figma_get_file',
  serverId: 'figma',
  content: rawMCPResponse,  // whatever your MCP server returned
})

// Get enriched, typed context
console.log(ctx.nodes)     // all nodes keyed by ID
console.log(ctx.meta)      // stats: totalNodes, enrichmentMs, avgConfidence

// Or specific formats
const json   = await client.getJSON()
const xml    = await client.getXML()
const pixels = await client.getPixelManifest()  // spatial-only, sorted by z-index
```

---

## Cross-server context

The real power: combine multiple MCP servers into a single unified context graph.

```typescript
const ctx = await client.processMany([
  { toolName: 'figma_get_file',     serverId: 'figma',  content: figmaResponse },
  { toolName: 'notion-fetch',       serverId: 'notion', content: notionResponse },
  { toolName: 'slack_messages',     serverId: 'slack',  content: slackResponse },
  { toolName: 'asana_get_tasks',    serverId: 'asana',  content: asanaResponse },
  { toolName: 'github_list_issues', serverId: 'github', content: githubResponse },
])

// Nodes with matching names are auto-linked across servers
// e.g. Figma frame "Dashboard" ↔ Notion page "Dashboard" ↔ Asana project "Dashboard"

ctx.nodes['frame-dashboard'].linkedNodes
// → [{ nodeId: 'notion:page-dashboard', source: 'notion', linkType: 'related' }]
```

---

## Built-in adapters

| Adapter | Source | Spatial | Semantic | Notes |
|---------|--------|---------|----------|-------|
| `FigmaAdapter` | Figma MCP | ✅ pixel-accurate | ✅ | x, y, w, h, fill, font, z-index, parent tree |
| `NotionAdapter` | Notion MCP | ❌ | ✅ | pages, databases, blocks, rich text |
| `SlackAdapter` | Slack MCP | ❌ | ✅ | messages, threads, channels, reactions |
| `AsanaAdapter` | Asana MCP | ❌ | ✅ | tasks, projects, sections, priority from due dates |
| `GitHubAdapter` | GitHub MCP | ❌ | ✅ | issues, PRs, repos, commits, files |
| `GenericAdapter` | Any MCP | ⚡ best-effort | ⚡ | fallback for unknown servers |

---

## Output formats

### JSON envelope (default)

Typed, versioned, includes confidence scores and cross-server links.

```typescript
const json = await client.getJSON(true) // pretty=true
```

### XML tree

Hierarchical — great for LLMs that work better with XML structure.

```typescript
const xml = await client.getXML()
// <?xml version="1.0"?>
// <emcp schema="emcp/v1" timestamp="...">
//   <nodes>
//     <node id="btn-submit" type="BUTTON" role="primary" ...>
//       <spatial x="1142" y="48" width="120" height="40"/>
//       <style fill="#0D99FF" borderRadius="8"/>
//       <confidence spatial="0.99" semantic="0.95" overall="0.97"/>
//     </node>
//   </nodes>
// </emcp>
```

### Pixel manifest

Flat array of all nodes with spatial data, sorted by z-index. Ideal for layout tools and design automation.

```typescript
const pixels = await client.getPixelManifest()
// [
//   { id: 'btn-submit', type: 'BUTTON', x: 1142, y: 48, width: 120, height: 40, fill: '#0D99FF', confidence: 0.97 },
//   ...
// ]
```

---

## Confidence scores

Every field has a confidence score so the LLM knows what to trust:

| Score | Meaning |
|-------|---------|
| `0.99` | Exact value from API (e.g. Figma bounding box) |
| `0.80–0.95` | Strongly inferred from API data |
| `0.50–0.79` | Inferred from text/name hints |
| `0.10–0.49` | Guessed / fallback value |

---

## Diff tracking

Track what changed between MCP calls — send only diffs instead of full context, saving tokens.

```typescript
const client = new EnhancedMCP({ diffTracking: true })

await client.process({ toolName: 'figma_get_file', serverId: 'figma', content: v1 })
const ctx2 = await client.process({ toolName: 'figma_get_file', serverId: 'figma', content: v2 })

ctx2.diff
// { added: ['new-btn-id'], removed: [], modified: ['frame-dashboard'] }
```

---

## Write a custom adapter

If you use an MCP server that isn't built-in, write a 20-line adapter:

```typescript
import type { EMCPAdapter, EnrichedNode } from '@odin_ssup/emcp'
import { EMCP_SCHEMA_VERSION } from '@odin_ssup/emcp'

export class MyAdapter implements EMCPAdapter {
  readonly name = 'my-server'
  readonly version = '1.0.0'

  canHandle(toolName: string): boolean {
    return toolName.includes('my_server')
  }

  async parse(toolName: string, response: unknown): Promise<EnrichedNode[]> {
    const raw = response as MyResponseType
    return [{
      id: raw.id,
      name: raw.name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'my-server',
      type: 'CONTAINER',
      role: 'structural',
      children: [],
      depth: 0,
      confidence: { spatial: 0.1, semantic: 0.8, style: 0.1, overall: 0.5 },
    }]
  }
}

// Register it
const client = new EnhancedMCP({ adapters: [new MyAdapter()] })
```

---

## CLI inspector

Inspect any raw MCP response file directly:

```bash
# Install globally
npm install -g @odin_ssup/emcp

# Inspect a response file
emcp inspect figma-response.json --tool figma_get_file

# Get pixel manifest only
emcp inspect figma-response.json --pixels

# Output as XML
emcp inspect figma-response.json --xml

# Show enrichment stats
emcp inspect figma-response.json --stats

# Pipe from MCP client
mcp-client call figma_get_file | emcp inspect --stdin --tool figma_get_file
```

---

## API reference

### `new EnhancedMCP(config?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `adapters` | `EMCPAdapter[]` | `[]` | Additional custom adapters |
| `enrichment` | `'minimal' \| 'standard' \| 'full'` | `'standard'` | How deep to enrich |
| `output` | `'json' \| 'xml' \| 'both'` | `'json'` | Default output format |
| `diffTracking` | `boolean` | `false` | Track changes between calls |
| `debug` | `boolean` | `false` | Verbose logging |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `process(response)` | `Promise<EnrichedContext>` | Process a single MCP response |
| `processMany(responses[])` | `Promise<EnrichedContext>` | Process multiple + auto-link |
| `getContext()` | `Promise<EnrichedContext>` | Get current registry state |
| `getJSON(pretty?)` | `Promise<string>` | JSON output |
| `getXML()` | `Promise<string>` | XML output |
| `getPixelManifest()` | `Promise<PixelManifestEntry[]>` | Spatial-only flat list |
| `linkNodes(idA, idB, type?)` | `void` | Manually link two nodes |
| `registerAdapter(adapter)` | `void` | Add a custom adapter |
| `clearContext()` | `void` | Reset the registry |

---

## Roadmap

- [x] Figma adapter — pixel-accurate spatial extraction
- [x] Notion adapter — pages, databases, blocks
- [x] Slack adapter — messages, threads, channels
- [x] Asana adapter — tasks, projects, sections, workspaces
- [x] GitHub adapter — issues, PRs, repos, commits, files
- [x] Generic fallback adapter
- [x] Cross-server context registry with auto-linking
- [x] Diff tracking between MCP calls
- [x] JSON / XML / pixel manifest output
- [x] CLI inspector (`emcp inspect`)
- [x] GitHub Actions CI (Node 18 / 20 / 22)
- [ ] Salesforce adapter
- [ ] Linear adapter
- [ ] Vector embedding-based entity linking
- [ ] MCP server registry
- [ ] Visual debug UI

---

## Contributing

PRs welcome. See [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md).

```bash
git clone https://github.com/mohanish28/emcp.git
cd emcp
npm install
npm test
```

---

## License

MIT# emcp

**Enhanced MCP** — a TypeScript package that wraps any MCP server and outputs enriched, typed, pixel-accurate, cross-server context for LLMs.

[![CI](https://github.com/mohanish28/emcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mohanish28/emcp/actions)
[![npm version](https://img.shields.io/npm/v/@odin_ssup/emcp)](https://www.npmjs.com/package/@odin_ssup/emcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## The problem

When you connect an MCP server (Figma, Notion, Slack) to an LLM, the model receives unstructured prose:

```
"Frame 'Dashboard' contains a button labeled Submit, blue color, top right area"
```

No coordinates. No hex values. No parent-child tree. The LLM has to guess — and it gets it wrong.

## The solution

`emcp` intercepts raw MCP responses and outputs this:

```json
{
  "id": "btn-submit",
  "type": "BUTTON",
  "label": "Submit",
  "source": "figma",
  "spatial": { "x": 1142, "y": 48, "width": 120, "height": 40 },
  "style": { "fill": "#0D99FF", "borderRadius": 8 },
  "parentId": "frame-dashboard",
  "confidence": { "spatial": 0.99, "semantic": 0.95, "overall": 0.97 },
  "schema": "emcp/v1"
}
```

Pixel-accurate. Typed. Versioned. Cross-server linked.

---

## Install

```bash
npm install @odin_ssup/emcp
```

---

## Quick start

```typescript
import { EnhancedMCP } from '@odin_ssup/emcp'

const client = new EnhancedMCP({
  enrichment: 'full',
  output: 'json',
})

// Wrap any raw MCP tool response
const ctx = await client.process({
  toolName: 'figma_get_file',
  serverId: 'figma',
  content: rawMCPResponse,  // whatever your MCP server returned
})

// Get enriched, typed context
console.log(ctx.nodes)     // all nodes keyed by ID
console.log(ctx.meta)      // stats: totalNodes, enrichmentMs, avgConfidence

// Or specific formats
const json   = await client.getJSON()
const xml    = await client.getXML()
const pixels = await client.getPixelManifest()  // spatial-only, sorted by z-index
```

---

## Cross-server context

The real power: combine multiple MCP servers into a single unified context graph.

```typescript
const ctx = await client.processMany([
  { toolName: 'figma_get_file',     serverId: 'figma',  content: figmaResponse },
  { toolName: 'notion-fetch',       serverId: 'notion', content: notionResponse },
  { toolName: 'slack_messages',     serverId: 'slack',  content: slackResponse },
  { toolName: 'asana_get_tasks',    serverId: 'asana',  content: asanaResponse },
  { toolName: 'github_list_issues', serverId: 'github', content: githubResponse },
])

// Nodes with matching names are auto-linked across servers
// e.g. Figma frame "Dashboard" ↔ Notion page "Dashboard" ↔ Asana project "Dashboard"

ctx.nodes['frame-dashboard'].linkedNodes
// → [{ nodeId: 'notion:page-dashboard', source: 'notion', linkType: 'related' }]
```

---

## Built-in adapters

| Adapter | Source | Spatial | Semantic | Notes |
|---------|--------|---------|----------|-------|
| `FigmaAdapter` | Figma MCP | ✅ pixel-accurate | ✅ | x, y, w, h, fill, font, z-index, parent tree |
| `NotionAdapter` | Notion MCP | ❌ | ✅ | pages, databases, blocks, rich text |
| `SlackAdapter` | Slack MCP | ❌ | ✅ | messages, threads, channels, reactions |
| `AsanaAdapter` | Asana MCP | ❌ | ✅ | tasks, projects, sections, priority from due dates |
| `GitHubAdapter` | GitHub MCP | ❌ | ✅ | issues, PRs, repos, commits, files |
| `GenericAdapter` | Any MCP | ⚡ best-effort | ⚡ | fallback for unknown servers |

---

## Output formats

### JSON envelope (default)

Typed, versioned, includes confidence scores and cross-server links.

```typescript
const json = await client.getJSON(true) // pretty=true
```

### XML tree

Hierarchical — great for LLMs that work better with XML structure.

```typescript
const xml = await client.getXML()
// <?xml version="1.0"?>
// <emcp schema="emcp/v1" timestamp="...">
//   <nodes>
//     <node id="btn-submit" type="BUTTON" role="primary" ...>
//       <spatial x="1142" y="48" width="120" height="40"/>
//       <style fill="#0D99FF" borderRadius="8"/>
//       <confidence spatial="0.99" semantic="0.95" overall="0.97"/>
//     </node>
//   </nodes>
// </emcp>
```

### Pixel manifest

Flat array of all nodes with spatial data, sorted by z-index. Ideal for layout tools and design automation.

```typescript
const pixels = await client.getPixelManifest()
// [
//   { id: 'btn-submit', type: 'BUTTON', x: 1142, y: 48, width: 120, height: 40, fill: '#0D99FF', confidence: 0.97 },
//   ...
// ]
```

---

## Confidence scores

Every field has a confidence score so the LLM knows what to trust:

| Score | Meaning |
|-------|---------|
| `0.99` | Exact value from API (e.g. Figma bounding box) |
| `0.80–0.95` | Strongly inferred from API data |
| `0.50–0.79` | Inferred from text/name hints |
| `0.10–0.49` | Guessed / fallback value |

---

## Diff tracking

Track what changed between MCP calls — send only diffs instead of full context, saving tokens.

```typescript
const client = new EnhancedMCP({ diffTracking: true })

await client.process({ toolName: 'figma_get_file', serverId: 'figma', content: v1 })
const ctx2 = await client.process({ toolName: 'figma_get_file', serverId: 'figma', content: v2 })

ctx2.diff
// { added: ['new-btn-id'], removed: [], modified: ['frame-dashboard'] }
```

---

## Write a custom adapter

If you use an MCP server that isn't built-in, write a 20-line adapter:

```typescript
import type { EMCPAdapter, EnrichedNode } from '@odin_ssup/emcp'
import { EMCP_SCHEMA_VERSION } from '@odin_ssup/emcp'

export class MyAdapter implements EMCPAdapter {
  readonly name = 'my-server'
  readonly version = '1.0.0'

  canHandle(toolName: string): boolean {
    return toolName.includes('my_server')
  }

  async parse(toolName: string, response: unknown): Promise<EnrichedNode[]> {
    const raw = response as MyResponseType
    return [{
      id: raw.id,
      name: raw.name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'my-server',
      type: 'CONTAINER',
      role: 'structural',
      children: [],
      depth: 0,
      confidence: { spatial: 0.1, semantic: 0.8, style: 0.1, overall: 0.5 },
    }]
  }
}

// Register it
const client = new EnhancedMCP({ adapters: [new MyAdapter()] })
```

---

## CLI inspector

Inspect any raw MCP response file directly:

```bash
# Install globally
npm install -g @odin_ssup/emcp

# Inspect a response file
emcp inspect figma-response.json --tool figma_get_file

# Get pixel manifest only
emcp inspect figma-response.json --pixels

# Output as XML
emcp inspect figma-response.json --xml

# Show enrichment stats
emcp inspect figma-response.json --stats

# Pipe from MCP client
mcp-client call figma_get_file | emcp inspect --stdin --tool figma_get_file
```

---

## API reference

### `new EnhancedMCP(config?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `adapters` | `EMCPAdapter[]` | `[]` | Additional custom adapters |
| `enrichment` | `'minimal' \| 'standard' \| 'full'` | `'standard'` | How deep to enrich |
| `output` | `'json' \| 'xml' \| 'both'` | `'json'` | Default output format |
| `diffTracking` | `boolean` | `false` | Track changes between calls |
| `debug` | `boolean` | `false` | Verbose logging |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `process(response)` | `Promise<EnrichedContext>` | Process a single MCP response |
| `processMany(responses[])` | `Promise<EnrichedContext>` | Process multiple + auto-link |
| `getContext()` | `Promise<EnrichedContext>` | Get current registry state |
| `getJSON(pretty?)` | `Promise<string>` | JSON output |
| `getXML()` | `Promise<string>` | XML output |
| `getPixelManifest()` | `Promise<PixelManifestEntry[]>` | Spatial-only flat list |
| `linkNodes(idA, idB, type?)` | `void` | Manually link two nodes |
| `registerAdapter(adapter)` | `void` | Add a custom adapter |
| `clearContext()` | `void` | Reset the registry |

---

## Roadmap

- [x] Figma adapter — pixel-accurate spatial extraction
- [x] Notion adapter — pages, databases, blocks
- [x] Slack adapter — messages, threads, channels
- [x] Asana adapter — tasks, projects, sections, workspaces
- [x] GitHub adapter — issues, PRs, repos, commits, files
- [x] Generic fallback adapter
- [x] Cross-server context registry with auto-linking
- [x] Diff tracking between MCP calls
- [x] JSON / XML / pixel manifest output
- [x] CLI inspector (`emcp inspect`)
- [x] GitHub Actions CI (Node 18 / 20 / 22)
- [ ] Salesforce adapter
- [ ] Linear adapter
- [ ] Vector embedding-based entity linking
- [ ] MCP server registry
- [ ] Visual debug UI

---

## Contributing

PRs welcome. See [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md).

```bash
git clone https://github.com/mohanish28/emcp.git
cd emcp
npm install
npm test
```

---

## License

MIT
