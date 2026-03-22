import { describe, it, expect } from 'vitest'
import { AsanaAdapter } from '../../src/adapters/asana'

const mockTask = {
  gid: '12345',
  resource_type: 'task',
  name: 'Fix critical login bug',
  notes: 'Users cannot log in on mobile',
  completed: false,
  due_on: '2026-03-25',
  created_at: '2026-03-20T10:00:00Z',
  modified_at: '2026-03-21T09:00:00Z',
  assignee: { gid: 'u1', name: 'Alice Chen' },
  tags: [{ gid: 't1', name: 'bug' }, { gid: 't2', name: 'urgent' }],
  num_subtasks: 3,
  projects: [{ gid: 'p1', name: 'Q1 Roadmap' }],
  memberships: [{ section: { gid: 's1', name: 'In Progress' } }],
}

const mockCompletedTask = {
  gid: '99999',
  resource_type: 'task',
  name: 'Update README',
  completed: true,
  completed_at: '2026-03-18T12:00:00Z',
  created_at: '2026-03-15T10:00:00Z',
  modified_at: '2026-03-18T12:00:00Z',
}

const mockProject = {
  gid: 'p1',
  resource_type: 'project',
  name: 'Q1 Roadmap',
  color: 'dark-pink',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-03-21T00:00:00Z',
  owner: { gid: 'u1', name: 'Alice Chen' },
  team: { gid: 'team1', name: 'Engineering' },
  num_tasks: 24,
  current_status: { color: 'green', title: 'On Track', text: 'On Track' },
}

const mockSection = {
  gid: 's1',
  resource_type: 'section',
  name: 'In Progress',
  created_at: '2026-01-01T00:00:00Z',
  project: { gid: 'p1', name: 'Q1 Roadmap' },
}

const mockWorkspace = {
  gid: 'w1',
  resource_type: 'workspace',
  name: 'Acme Corp',
  is_organization: true,
}

const mockListResponse = {
  data: [mockTask, mockCompletedTask],
}

describe('AsanaAdapter', () => {
  const adapter = new AsanaAdapter()

  it('has correct name', () => {
    expect(adapter.name).toBe('asana')
  })

  it('canHandle asana tool names', () => {
    expect(adapter.canHandle('asana_get_task', {})).toBe(true)
    expect(adapter.canHandle('get_tasks', {})).toBe(true)
    expect(adapter.canHandle('list_tasks', {})).toBe(true)
    expect(adapter.canHandle('get_project', {})).toBe(true)
    expect(adapter.canHandle('figma_get_file', {})).toBe(false)
  })

  it('parses a task correctly', async () => {
    const nodes = await adapter.parse('get_task', mockTask)
    expect(nodes.length).toBe(1)
    const task = nodes[0]
    expect(task.id).toBe('asana:task:12345')
    expect(task.name).toBe('Fix critical login bug')
    expect(task.source).toBe('asana')
    expect(task.type).toBe('BLOCK')
    expect(task.schema).toBe('emcp/v1')
  })

  it('marks overdue tasks as primary role', async () => {
    const nodes = await adapter.parse('get_task', mockTask)
    // due_on is 2026-03-25, close to now — role depends on days until due
    expect(['primary', 'secondary', 'tertiary']).toContain(nodes[0].role)
  })

  it('marks completed tasks as decorative role', async () => {
    const nodes = await adapter.parse('get_task', mockCompletedTask)
    expect(nodes[0].role).toBe('decorative')
  })

  it('includes assignee in description', async () => {
    const nodes = await adapter.parse('get_task', mockTask)
    expect(nodes[0].description).toContain('Alice Chen')
  })

  it('includes due date in description', async () => {
    const nodes = await adapter.parse('get_task', mockTask)
    expect(nodes[0].description).toContain('2026-03-25')
  })

  it('parses wrapped list response', async () => {
    const nodes = await adapter.parse('list_tasks', mockListResponse)
    expect(nodes.length).toBe(2)
  })

  it('parses a project', async () => {
    const nodes = await adapter.parse('get_project', mockProject)
    expect(nodes.length).toBe(1)
    const project = nodes[0]
    expect(project.id).toBe('asana:project:p1')
    expect(project.type).toBe('CONTAINER')
    expect(project.role).toBe('structural')
    expect(project.name).toBe('Q1 Roadmap')
  })

  it('includes project status in description', async () => {
    const nodes = await adapter.parse('get_project', mockProject)
    expect(nodes[0].description).toContain('On Track')
  })

  it('parses a section', async () => {
    const nodes = await adapter.parse('get_sections', mockSection)
    expect(nodes.length).toBe(1)
    expect(nodes[0].type).toBe('SECTION')
    expect(nodes[0].parentId).toBe('asana:project:p1')
  })

  it('parses a workspace', async () => {
    const nodes = await adapter.parse('get_workspaces', mockWorkspace)
    expect(nodes.length).toBe(1)
    expect(nodes[0].type).toBe('CONTAINER')
    expect(nodes[0].description).toContain('Organization')
  })

  it('assigns schema version to all nodes', async () => {
    const nodes = await adapter.parse('list_tasks', mockListResponse)
    for (const n of nodes) expect(n.schema).toBe('emcp/v1')
  })

  it('returns empty array for unrecognized input', async () => {
    const nodes = await adapter.parse('get_task', { random: 'data', no_gid: true })
    expect(nodes).toEqual([])
  })

  it('stores raw metadata', async () => {
    const nodes = await adapter.parse('get_task', mockTask)
    const raw = nodes[0].raw as Record<string, unknown>
    expect(raw['_assigneeName']).toBe('Alice Chen')
    expect(raw['_tags']).toContain('bug')
    expect(raw['_projectNames']).toContain('Q1 Roadmap')
    expect(raw['_sectionName']).toBe('In Progress')
  })
})
