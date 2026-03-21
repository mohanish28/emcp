import { z } from 'zod'
import type { EMCPAdapter, EnrichedNode } from '../../core/types.js'
import { EMCP_SCHEMA_VERSION } from '../../core/types.js'
import { ConfidenceScorer } from '../../enrichment/scorer.js'

// ─── Slack API shapes ──────────────────────────────────────────────────────────

const SlackUserSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  real_name: z.string().optional(),
  display_name: z.string().optional(),
  is_bot: z.boolean().optional(),
  deleted: z.boolean().optional(),
  email: z.string().optional(),
})

const SlackChannelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  topic: z.object({ value: z.string() }).optional(),
  purpose: z.object({ value: z.string() }).optional(),
  num_members: z.number().optional(),
  is_private: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  created: z.number().optional(),
})

const SlackAttachmentSchema = z.object({
  id: z.number().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  fallback: z.string().optional(),
  color: z.string().optional(),
  pretext: z.string().optional(),
  author_name: z.string().optional(),
  image_url: z.string().optional(),
  thumb_url: z.string().optional(),
  footer: z.string().optional(),
})

const SlackBlockSchema = z.object({
  type: z.string(),
  block_id: z.string().optional(),
  text: z.object({ type: z.string(), text: z.string() }).optional(),
  elements: z.array(z.unknown()).optional(),
  fields: z.array(z.object({ type: z.string(), text: z.string() })).optional(),
})

const SlackMessageSchema = z.object({
  ts: z.string(),
  type: z.string().optional(),
  text: z.string().optional(),
  user: z.string().optional(),
  username: z.string().optional(),
  bot_id: z.string().optional(),
  thread_ts: z.string().optional(),
  reply_count: z.number().optional(),
  reactions: z
    .array(z.object({ name: z.string(), count: z.number(), users: z.array(z.string()) }))
    .optional(),
  attachments: z.array(SlackAttachmentSchema).optional(),
  blocks: z.array(SlackBlockSchema).optional(),
  files: z.array(z.object({ id: z.string(), name: z.string(), mimetype: z.string().optional() })).optional(),
  pinned_to: z.array(z.string()).optional(),
  channel: z.string().optional(),
})

const SlackListResponseSchema = z.object({
  ok: z.boolean(),
  messages: z.array(SlackMessageSchema).optional(),
  channels: z.array(SlackChannelSchema).optional(),
  members: z.array(SlackUserSchema).optional(),
  channel: SlackChannelSchema.optional(),
  user: SlackUserSchema.optional(),
  message: SlackMessageSchema.optional(),
})

type SlackMessage = z.infer<typeof SlackMessageSchema>
type SlackChannel = z.infer<typeof SlackChannelSchema>
type SlackUser = z.infer<typeof SlackUserSchema>

// ─── Helpers ───────────────────────────────────────────────────────────────────

function tsToIso(ts: string): string {
  const ms = parseFloat(ts) * 1000
  return new Date(ms).toISOString()
}

function truncate(text: string, maxLen = 120): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

// ─── Slack Adapter ─────────────────────────────────────────────────────────────

export class SlackAdapter implements EMCPAdapter {
  readonly name = 'slack'
  readonly version = '1.0.0'

  private scorer = new ConfidenceScorer()

  canHandle(toolName: string, _response: unknown): boolean {
    return (
      toolName.includes('slack') ||
      toolName.includes('get_messages') ||
      toolName.includes('list_channels') ||
      toolName.includes('get_channel') ||
      toolName.includes('search_slack') ||
      toolName.includes('conversations_history') ||
      toolName.includes('conversations_list')
    )
  }

  async parse(_toolName: string, response: unknown): Promise<EnrichedNode[]> {
    const nodes: EnrichedNode[] = []

    const result = SlackListResponseSchema.safeParse(response)
    if (!result.success) return nodes

    const data = result.data

    // Messages
    if (data.messages) {
      for (let i = 0; i < data.messages.length; i++) {
        nodes.push(this.parseMessage(data.messages[i], i))
      }
    }

    // Channels
    if (data.channels) {
      for (const ch of data.channels) {
        nodes.push(this.parseChannel(ch))
      }
    }

    // Members
    if (data.members) {
      for (const u of data.members) {
        nodes.push(this.parseUser(u))
      }
    }

    // Single channel
    if (data.channel) {
      nodes.push(this.parseChannel(data.channel))
    }

    // Single user
    if (data.user) {
      nodes.push(this.parseUser(data.user))
    }

    // Single message
    if (data.message) {
      nodes.push(this.parseMessage(data.message, 0))
    }

    // Thread grouping — link replies to their parent
    this.linkThreads(nodes)

    return nodes
  }

  private parseMessage(msg: SlackMessage, index: number): EnrichedNode {
    const text = msg.text ?? ''
    const isThreadReply = msg.thread_ts !== undefined && msg.thread_ts !== msg.ts
    const isThreadParent = (msg.reply_count ?? 0) > 0
    const hasAttachments = (msg.attachments?.length ?? 0) > 0
    const hasFiles = (msg.files?.length ?? 0) > 0

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.88,
      styleFromApi: false,
      hasChildren: isThreadParent,
      hasParent: isThreadReply,
    })

    const id = `slack:msg:${msg.ts}`

    return {
      id,
      name: truncate(text || `Message at ${msg.ts}`, 60),
      schema: EMCP_SCHEMA_VERSION,
      source: 'slack',
      sourceId: msg.ts,
      type: 'BLOCK',
      role: isThreadParent ? 'primary' : isThreadReply ? 'secondary' : 'unknown',
      label: text || undefined,
      description: [
        isThreadParent ? `${msg.reply_count} replies` : null,
        hasAttachments ? `${msg.attachments!.length} attachments` : null,
        hasFiles ? `${msg.files!.length} files` : null,
      ]
        .filter(Boolean)
        .join(', ') || undefined,
      parentId: isThreadReply ? `slack:msg:${msg.thread_ts}` : undefined,
      children: [],
      depth: isThreadReply ? 1 : 0,
      confidence,
      createdAt: tsToIso(msg.ts),
      raw: {
        ...msg,
        _index: index,
        _isThreadParent: isThreadParent,
        _isThreadReply: isThreadReply,
        _reactionCount: msg.reactions?.reduce((sum, r) => sum + r.count, 0) ?? 0,
        _topReactions: msg.reactions?.slice(0, 3).map((r) => `${r.name}(${r.count})`).join(' ') ?? '',
      } as Record<string, unknown>,
    }
  }

  private parseChannel(ch: SlackChannel): EnrichedNode {
    const name = ch.name ?? ch.id
    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.92,
      styleFromApi: false,
      hasChildren: true,
      hasParent: false,
    })

    return {
      id: `slack:channel:${ch.id}`,
      name: `#${name}`,
      schema: EMCP_SCHEMA_VERSION,
      source: 'slack',
      sourceId: ch.id,
      type: 'CONTAINER',
      role: 'structural',
      label: `#${name}`,
      description: ch.topic?.value || ch.purpose?.value || undefined,
      parentId: undefined,
      children: [],
      depth: 0,
      confidence,
      raw: ch as unknown as Record<string, unknown>,
    }
  }

  private parseUser(u: SlackUser): EnrichedNode {
    const name = u.real_name ?? u.display_name ?? u.name ?? u.id
    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.9,
      styleFromApi: false,
      hasChildren: false,
      hasParent: false,
    })

    return {
      id: `slack:user:${u.id}`,
      name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'slack',
      sourceId: u.id,
      type: 'BLOCK',
      role: 'structural',
      label: name,
      description: u.email || (u.is_bot ? 'Bot user' : undefined),
      parentId: undefined,
      children: [],
      depth: 0,
      confidence,
      raw: u as unknown as Record<string, unknown>,
    }
  }

  private linkThreads(nodes: EnrichedNode[]): void {
    const msgMap = new Map(nodes.map((n) => [n.id, n]))

    for (const node of nodes) {
      if (node.parentId && msgMap.has(node.parentId)) {
        const parent = msgMap.get(node.parentId)!
        if (!parent.children.includes(node.id)) {
          parent.children.push(node.id)
        }
      }
    }
  }
}
