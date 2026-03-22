import { describe, it, expect } from 'vitest'
import { GitHubAdapter } from '../../src/adapters/github'

const mockIssue = {
  id: 1001,
  number: 42,
  title: 'Fix authentication timeout on mobile',
  body: 'Users report being logged out after 5 minutes on mobile devices.',
  state: 'open' as const,
  html_url: 'https://github.com/acme/app/issues/42',
  created_at: '2026-03-15T10:00:00Z',
  updated_at: '2026-03-21T09:00:00Z',
  user: { login: 'mohanish28' },
  assignee: { login: 'alice' },
  labels: [
    { id: 1, name: 'bug', color: 'd73a4a' },
    { id: 2, name: 'mobile', color: '0075ca' },
  ],
  comments: 7,
  reactions: { total_count: 12, '+1': 8, '-1': 0 },
}

const mockPR = {
  id: 2001,
  number: 55,
  title: 'feat: add emcp Figma adapter',
  body: 'Adds pixel-accurate Figma MCP enrichment.',
  state: 'open' as const,
  html_url: 'https://github.com/acme/app/pull/55',
  created_at: '2026-03-20T08:00:00Z',
  updated_at: '2026-03-21T11:00:00Z',
  user: { login: 'mohanish28' },
  labels: [],
  comments: 3,
  head: { ref: 'feat/figma-adapter', sha: 'abc123' },
  base: { ref: 'main', sha: 'def456' },
  merged: false,
  draft: false,
  additions: 450,
  deletions: 12,
  changed_files: 8,
  commits: 4,
  requested_reviewers: [{ login: 'bob' }, { login: 'carol' }],
}

const mockRepo = {
  id: 3001,
  name: 'emcp',
  full_name: 'mohanish28/emcp',
  description: 'Enhanced MCP context enrichment',
  private: false,
  html_url: 'https://github.com/mohanish28/emcp',
  created_at: '2026-03-21T00:00:00Z',
  updated_at: '2026-03-22T00:00:00Z',
  language: 'TypeScript',
  stargazers_count: 42,
  forks_count: 3,
  open_issues_count: 5,
  default_branch: 'main',
  topics: ['mcp', 'llm', 'figma', 'typescript'],
  owner: { login: 'mohanish28' },
  license: { name: 'MIT' },
}

const mockCommit = {
  sha: 'abc123def456',
  html_url: 'https://github.com/mohanish28/emcp/commit/abc123',
  commit: {
    message: 'feat: add Figma adapter with pixel extraction\n\nExtracts x, y, width, height from Figma API',
    author: { name: 'Mohanish', date: '2026-03-21T10:00:00Z' },
  },
  author: { login: 'mohanish28' },
  stats: { additions: 250, deletions: 10, total: 260 },
  files: [
    { filename: 'src/adapters/figma/index.ts', status: 'added', additions: 200, deletions: 0 },
    { filename: 'tests/unit/figma-adapter.test.ts', status: 'added', additions: 50, deletions: 0 },
  ],
}

const mockFile = {
  name: 'index.ts',
  path: 'src/adapters/figma/index.ts',
  sha: 'file123',
  size: 9200,
  type: 'file' as const,
  html_url: 'https://github.com/mohanish28/emcp/blob/main/src/adapters/figma/index.ts',
}

const mockSearchResult = {
  total_count: 2,
  incomplete_results: false,
  items: [mockIssue, { ...mockIssue, id: 1002, number: 43, title: 'Login form validation error' }],
}

describe('GitHubAdapter', () => {
  const adapter = new GitHubAdapter()

  it('has correct name', () => {
    expect(adapter.name).toBe('github')
  })

  it('canHandle github tool names', () => {
    expect(adapter.canHandle('github_get_issue', {})).toBe(true)
    expect(adapter.canHandle('get_issue', {})).toBe(true)
    expect(adapter.canHandle('list_issues', {})).toBe(true)
    expect(adapter.canHandle('get_pull', {})).toBe(true)
    expect(adapter.canHandle('get_repo', {})).toBe(true)
    expect(adapter.canHandle('list_commits', {})).toBe(true)
    expect(adapter.canHandle('asana_get_task', {})).toBe(false)
  })

  it('parses an issue correctly', async () => {
    const nodes = await adapter.parse('get_issue', mockIssue)
    expect(nodes.length).toBe(1)
    const issue = nodes[0]
    expect(issue.id).toBe('github:issue:1001')
    expect(issue.name).toBe('#42 Fix authentication timeout on mobile')
    expect(issue.label).toBe('Fix authentication timeout on mobile')
    expect(issue.source).toBe('github')
    expect(issue.schema).toBe('emcp/v1')
  })

  it('marks bug issues as primary role', async () => {
    const nodes = await adapter.parse('get_issue', mockIssue)
    expect(nodes[0].role).toBe('primary')
  })

  it('marks closed issues as decorative', async () => {
    const closed = { ...mockIssue, state: 'closed' as const }
    const nodes = await adapter.parse('get_issue', closed)
    expect(nodes[0].role).toBe('decorative')
  })

  it('extracts label color as fill style', async () => {
    const nodes = await adapter.parse('get_issue', mockIssue)
    expect(nodes[0].style?.fill).toBe('#d73a4a')
  })

  it('includes assignee in description', async () => {
    const nodes = await adapter.parse('get_issue', mockIssue)
    expect(nodes[0].description).toContain('@alice')
  })

  it('parses a PR correctly', async () => {
    const nodes = await adapter.parse('get_pull', mockPR)
    expect(nodes.length).toBe(1)
    const pr = nodes[0]
    expect(pr.id).toBe('github:pr:2001')
    expect(pr.name).toBe('PR #55 feat: add emcp Figma adapter')
  })

  it('includes branch info in PR description', async () => {
    const nodes = await adapter.parse('get_pull', mockPR)
    expect(nodes[0].description).toContain('feat/figma-adapter')
    expect(nodes[0].description).toContain('main')
  })

  it('includes diff stats in PR description', async () => {
    const nodes = await adapter.parse('get_pull', mockPR)
    expect(nodes[0].description).toContain('+450')
  })

  it('parses a repo correctly', async () => {
    const nodes = await adapter.parse('get_repo', mockRepo)
    expect(nodes.length).toBe(1)
    const repo = nodes[0]
    expect(repo.id).toBe('github:repo:3001')
    expect(repo.name).toBe('mohanish28/emcp')
    expect(repo.type).toBe('CONTAINER')
  })

  it('includes stars and language in repo description', async () => {
    const nodes = await adapter.parse('get_repo', mockRepo)
    expect(nodes[0].description).toContain('TypeScript')
    expect(nodes[0].description).toContain('42')
  })

  it('parses a commit correctly', async () => {
    const nodes = await adapter.parse('get_commit', mockCommit)
    expect(nodes.length).toBe(1)
    const commit = nodes[0]
    expect(commit.id).toBe('github:commit:abc123def456')
    expect(commit.name).toBe('feat: add Figma adapter with pixel extraction')
    expect(commit.children).toContain('github:file:src/adapters/figma/index.ts')
  })

  it('parses a file correctly', async () => {
    const nodes = await adapter.parse('get_file_contents', mockFile)
    expect(nodes.length).toBe(1)
    const file = nodes[0]
    expect(file.id).toBe('github:file:src/adapters/figma/index.ts')
    expect(file.type).toBe('BLOCK')
    expect(file.depth).toBe(3) // src/adapters/figma/index.ts = depth 3
  })

  it('parses search results', async () => {
    const nodes = await adapter.parse('search_issues', mockSearchResult)
    expect(nodes.length).toBe(2)
  })

  it('parses array of issues', async () => {
    const nodes = await adapter.parse('list_issues', [mockIssue, mockIssue])
    expect(nodes.length).toBe(2)
  })

  it('returns empty array for unrecognized input', async () => {
    const nodes = await adapter.parse('get_issue', { random: 'garbage' })
    expect(nodes).toEqual([])
  })

  it('stores useful raw metadata on issues', async () => {
    const nodes = await adapter.parse('get_issue', mockIssue)
    const raw = nodes[0].raw as Record<string, unknown>
    expect(raw['_isOpen']).toBe(true)
    expect(raw['_labelNames']).toContain('bug')
    expect(raw['_upvotes']).toBe(8)
  })

  it('stores useful raw metadata on PRs', async () => {
    const nodes = await adapter.parse('get_pull', mockPR)
    const raw = nodes[0].raw as Record<string, unknown>
    expect(raw['_isDraft']).toBe(false)
    expect(raw['_branch']).toBe('feat/figma-adapter')
    expect(raw['_reviewers']).toContain('bob')
  })
})
