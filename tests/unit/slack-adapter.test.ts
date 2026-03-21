import { describe, it, expect } from 'vitest'
import { SlackAdapter } from '../../src/adapters/slack'

const mockSlackMessages = {
  ok: true,
  messages: [
    {
      ts: '1711000000.000001',
      type: 'message',
      text: 'Hey team, the new dashboard design is ready for review in Figma',
      user: 'U123',
      reply_count: 3,
      reactions: [{ name: 'white_check_mark', count: 4, users: ['U124', 'U125', 'U126', 'U127'] }],
    },
    {
      ts: '1711000100.000001',
      type: 'message',
      text: 'Looks great! Approved.',
      user: 'U124',
      thread_ts: '1711000000.000001',
    },
    {
      ts: '1711000200.000001',
      type: 'message',
      text: 'One question about the button spacing',
      user: 'U125',
      thread_ts: '1711000000.000001',
    },
  ],
}

const mockSlackChannels = {
  ok: true,
  channels: [
    { id: 'C001', name: 'design-system', topic: { value: 'Design system discussions' }, num_members: 42 },
    { id: 'C002', name: 'engineering', topic: { value: 'Engineering team' }, num_members: 18 },
  ],
}

describe('SlackAdapter', () => {
  const adapter = new SlackAdapter()

  it('has correct name', () => {
    expect(adapter.name).toBe('slack')
  })

  it('canHandle slack tool names', () => {
    expect(adapter.canHandle('slack_get_messages', {})).toBe(true)
    expect(adapter.canHandle('list_channels', {})).toBe(true)
    expect(adapter.canHandle('conversations_history', {})).toBe(true)
    expect(adapter.canHandle('figma_get_file', {})).toBe(false)
  })

  it('parses messages correctly', async () => {
    const nodes = await adapter.parse('slack_get_messages', mockSlackMessages)
    expect(nodes.length).toBe(3)
  })

  it('assigns correct schema version', async () => {
    const nodes = await adapter.parse('slack_get_messages', mockSlackMessages)
    for (const n of nodes) expect(n.schema).toBe('emcp/v1')
  })

  it('marks thread parent correctly', async () => {
    const nodes = await adapter.parse('slack_get_messages', mockSlackMessages)
    const parent = nodes.find((n) => n.sourceId === '1711000000.000001')
    expect(parent?.role).toBe('primary')
    expect(parent?.children.length).toBe(2)
  })

  it('marks thread replies correctly', async () => {
    const nodes = await adapter.parse('slack_get_messages', mockSlackMessages)
    const reply = nodes.find((n) => n.sourceId === '1711000100.000001')
    expect(reply?.role).toBe('secondary')
    expect(reply?.parentId).toBe('slack:msg:1711000000.000001')
    expect(reply?.depth).toBe(1)
  })

  it('extracts message text as label', async () => {
    const nodes = await adapter.parse('slack_get_messages', mockSlackMessages)
    const first = nodes[0]
    expect(first.label).toContain('dashboard design')
  })

  it('parses channels', async () => {
    const nodes = await adapter.parse('list_channels', mockSlackChannels)
    expect(nodes.length).toBe(2)
    const design = nodes.find((n) => n.name === '#design-system')
    expect(design).toBeDefined()
    expect(design?.type).toBe('CONTAINER')
    expect(design?.description).toContain('Design system')
  })

  it('returns empty array for unrecognized input', async () => {
    const nodes = await adapter.parse('slack_get_messages', { totally: 'wrong' })
    expect(nodes).toEqual([])
  })

  it('sets source to slack', async () => {
    const nodes = await adapter.parse('slack_get_messages', mockSlackMessages)
    for (const n of nodes) expect(n.source).toBe('slack')
  })
})
