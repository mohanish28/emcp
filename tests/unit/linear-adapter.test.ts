import { describe, it, expect } from 'vitest'
import { LinearAdapter } from '../../src/adapters/linear'

const mockIssue = {
  id: 'issue-abc-123',
  identifier: 'ENG-123',
  title: 'Fix authentication token expiry',
  description: 'JWT tokens expire too quickly on mobile clients.',
  priority: 2,
  priorityLabel: 'High',
  state: { id: 'state-1', name: 'In Progress', type: 'started', color: '#F59E0B' },
  assignee: { id: 'user-1', name: 'Alice Chen', email: 'alice@company.com' },
  team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
  project: { id: 'proj-1', name: 'Q1 Roadmap' },
  cycle: { id: 'cycle-1', name: 'Sprint 14', number: 14 },
  labels: { nodes: [{ id: 'label-1', name: 'bug', color: '#EF4444' }] },
  estimate: 3,
  dueDate: '2026-03-28',
  createdAt: '2026-03-15T10:00:00Z',
  updatedAt: '2026-03-21T09:00:00Z',
  url: 'https://linear.app/company/issue/ENG-123',
  branchName: 'alice/eng-123-fix-auth-token',
  comments: { totalCount: 5 },
  children: { nodes: [] },
}

const mockCompletedIssue = {
  id: 'issue-def-456',
  identifier: 'ENG-100',
  title: 'Update dependencies',
  priority: 4,
  priorityLabel: 'Low',
  state: { id: 'state-done', name: 'Done', type: 'completed', color: '#10B981' },
  completedAt: '2026-03-10T14:00:00Z',
  createdAt: '2026-03-05T00:00:00Z',
  updatedAt: '2026-03-10T14:00:00Z',
  children: { nodes: [] },
  labels: { nodes: [] },
}

const mockSubIssue = {
  id: 'issue-sub-789',
  identifier: 'ENG-124',
  title: 'Write tests for token refresh',
  priority: 3,
  priorityLabel: 'Medium',
  state: { id: 'state-1', name: 'Todo', type: 'unstarted', color: '#6B7280' },
  parent: { id: 'issue-abc-123', title: 'Fix authentication token expiry', identifier: 'ENG-123' },
  createdAt: '2026-03-16T00:00:00Z',
  updatedAt: '2026-03-16T00:00:00Z',
  children: { nodes: [] },
  labels: { nodes: [] },
}

const mockProject = {
  id: 'proj-1',
  name: 'Q1 Roadmap',
  description: 'Q1 2026 engineering initiatives',
  state: 'started' as const,
  color: '#3B82F6',
  progress: 0.45,
  startDate: '2026-01-01',
  targetDate: '2026-03-31',
  lead: { id: 'user-1', name: 'Alice Chen' },
  issueCount: 42,
  completedIssueCount: 19,
  createdAt: '2025-12-15T00:00:00Z',
  updatedAt: '2026-03-21T00:00:00Z',
}

const mockTeam = {
  id: 'team-1',
  name: 'Engineering',
  key: 'ENG',
  description: 'Core engineering team',
  color: '#6366F1',
  issueCount: 156,
}

const mockCycle = {
  id: 'cycle-1',
  number: 14,
  name: 'Sprint 14',
  startsAt: '2026-03-18T00:00:00Z',
  endsAt: '2026-04-01T00:00:00Z',
  progress: 0.6,
  issueCount: 18,
  completedIssueCount: 11,
  team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
}

const mockConnection = {
  nodes: [mockIssue, mockCompletedIssue],
  pageInfo: { hasNextPage: false, endCursor: null },
}

describe('LinearAdapter', () => {
  const adapter = new LinearAdapter()

  it('has correct name', () => {
    expect(adapter.name).toBe('linear')
  })

  it('canHandle linear tool names', () => {
    expect(adapter.canHandle('linear_get_issue', {})).toBe(true)
    expect(adapter.canHandle('list_issues', {})).toBe(true)
    expect(adapter.canHandle('get_project', {})).toBe(true)
    expect(adapter.canHandle('get_cycle', {})).toBe(true)
    expect(adapter.canHandle('search_issues', {})).toBe(true)
    expect(adapter.canHandle('salesforce_get_record', {})).toBe(false)
  })

  it('parses an issue correctly', async () => {
    const nodes = await adapter.parse('get_issue', mockIssue)
    expect(nodes.length).toBe(1)
    const issue = nodes[0]
    expect(issue.id).toBe('linear:issue:issue-abc-123')
    expect(issue.name).toBe('ENG-123 Fix authentication token expiry')
    expect(issue.label).toBe('Fix authentication token expiry')
    expect(issue.source).toBe('linear')
    expect(issue.schema).toBe('emcp/v1')
  })

  it('marks high priority issue as primary', async () => {
    const nodes = await adapter.parse('get_issue', mockIssue)
    expect(nodes[0].role).toBe('primary') // priority 2 = high
  })

  it('marks completed issue as decorative', async () => {
    const nodes = await adapter.parse('get_issue', mockCompletedIssue)
    expect(nodes[0].role).toBe('decorative')
  })

  it('includes identifier in description fields', async () => {
    const nodes = await adapter.parse('get_issue', mockIssue)
    expect(nodes[0].description).toContain('In Progress')
    expect(nodes[0].description).toContain('High')
    expect(nodes[0].description).toContain('Alice Chen')
    expect(nodes[0].description).toContain('Q1 Roadmap')
    expect(nodes[0].description).toContain('Cycle 14')
  })

  it('sets label color as fill style', async () => {
    const nodes = await adapter.parse('get_issue', mockIssue)
    expect(nodes[0].style?.fill).toBe('#EF4444')
  })

  it('sets parentId for sub-issues', async () => {
    const nodes = await adapter.parse('get_issue', mockSubIssue)
    expect(nodes[0].parentId).toBe('linear:issue:issue-abc-123')
    expect(nodes[0].depth).toBe(1)
  })

  it('parses a GraphQL connection response', async () => {
    const nodes = await adapter.parse('list_issues', mockConnection)
    expect(nodes.length).toBe(2)
  })

  it('parses a project', async () => {
    const nodes = await adapter.parse('get_project', mockProject)
    expect(nodes.length).toBe(1)
    const proj = nodes[0]
    expect(proj.id).toBe('linear:project:proj-1')
    expect(proj.type).toBe('CONTAINER')
    expect(proj.style?.fill).toBe('#3B82F6')
    expect(proj.description).toContain('45% complete')
    expect(proj.description).toContain('Alice Chen')
  })

  it('parses a team', async () => {
    const nodes = await adapter.parse('get_team', mockTeam)
    expect(nodes.length).toBe(1)
    const team = nodes[0]
    expect(team.id).toBe('linear:team:team-1')
    expect(team.type).toBe('CONTAINER')
    expect(team.style?.fill).toBe('#6366F1')
    expect(team.description).toContain('ENG')
  })

  it('parses a cycle', async () => {
    const nodes = await adapter.parse('get_cycle', mockCycle)
    expect(nodes.length).toBe(1)
    const cycle = nodes[0]
    expect(cycle.id).toBe('linear:cycle:cycle-1')
    expect(cycle.name).toBe('Sprint 14')
    expect(cycle.description).toContain('60% complete')
    expect(cycle.parentId).toBe('linear:team:team-1')
  })

  it('returns empty array for unrecognized input', async () => {
    const nodes = await adapter.parse('get_issue', { random: 'garbage' })
    expect(nodes).toEqual([])
  })

  it('stores rich raw metadata on issues', async () => {
    const nodes = await adapter.parse('get_issue', mockIssue)
    const raw = nodes[0].raw as Record<string, unknown>
    expect(raw['_identifier']).toBe('ENG-123')
    expect(raw['_priority']).toBe(2)
    expect(raw['_assigneeName']).toBe('Alice Chen')
    expect(raw['_teamName']).toBe('Engineering')
    expect(raw['_branchName']).toBe('alice/eng-123-fix-auth-token')
    expect(raw['_labelNames']).toContain('bug')
    expect(raw['_estimate']).toBe(3)
  })
})
