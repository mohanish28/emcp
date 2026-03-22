import { z } from 'zod'
import type { EMCPAdapter, EnrichedNode } from '../../core/types.js'
import { EMCP_SCHEMA_VERSION } from '../../core/types.js'
import { ConfidenceScorer } from '../../enrichment/scorer.js'

// ─── GitHub API shapes ─────────────────────────────────────────────────────────

const GitHubUserSchema = z.object({
  login: z.string(),
  id: z.number().optional(),
  avatar_url: z.string().optional(),
  html_url: z.string().optional(),
  type: z.string().optional(),
})

const GitHubLabelSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
  color: z.string().optional(),
  description: z.string().nullable().optional(),
})

const GitHubMilestoneSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string().optional(),
  due_on: z.string().nullable().optional(),
})

const GitHubIssueSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().optional(),
  state: z.enum(['open', 'closed']),
  state_reason: z.string().nullable().optional(),
  html_url: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable().optional(),
  user: GitHubUserSchema.optional(),
  assignee: GitHubUserSchema.nullable().optional(),
  assignees: z.array(GitHubUserSchema).optional(),
  labels: z.array(GitHubLabelSchema).optional(),
  milestone: GitHubMilestoneSchema.nullable().optional(),
  comments: z.number().optional(),
  reactions: z.object({
    total_count: z.number().optional(),
    '+1': z.number().optional(),
    '-1': z.number().optional(),
  }).optional(),
  pull_request: z.object({ url: z.string() }).optional(), // present if it's a PR
  draft: z.boolean().optional(),
})

const GitHubPRSchema = GitHubIssueSchema.extend({
  head: z.object({
    ref: z.string(),
    sha: z.string(),
    repo: z.object({ full_name: z.string() }).nullable().optional(),
  }).optional(),
  base: z.object({
    ref: z.string(),
    sha: z.string(),
  }).optional(),
  merged: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
  mergeable: z.boolean().nullable().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  changed_files: z.number().optional(),
  commits: z.number().optional(),
  review_comments: z.number().optional(),
  requested_reviewers: z.array(GitHubUserSchema).optional(),
})

const GitHubRepoSchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable().optional(),
  private: z.boolean().optional(),
  html_url: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  pushed_at: z.string().optional(),
  language: z.string().nullable().optional(),
  stargazers_count: z.number().optional(),
  forks_count: z.number().optional(),
  open_issues_count: z.number().optional(),
  default_branch: z.string().optional(),
  topics: z.array(z.string()).optional(),
  owner: GitHubUserSchema.optional(),
  license: z.object({ name: z.string() }).nullable().optional(),
  size: z.number().optional(),
  archived: z.boolean().optional(),
  disabled: z.boolean().optional(),
})

const GitHubCommitSchema = z.object({
  sha: z.string(),
  html_url: z.string().optional(),
  commit: z.object({
    message: z.string(),
    author: z.object({
      name: z.string().optional(),
      email: z.string().optional(),
      date: z.string().optional(),
    }).optional(),
    committer: z.object({
      name: z.string().optional(),
      date: z.string().optional(),
    }).optional(),
    comment_count: z.number().optional(),
  }),
  author: GitHubUserSchema.nullable().optional(),
  stats: z.object({
    additions: z.number().optional(),
    deletions: z.number().optional(),
    total: z.number().optional(),
  }).optional(),
  files: z.array(z.object({
    filename: z.string(),
    status: z.string().optional(),
    additions: z.number().optional(),
    deletions: z.number().optional(),
  })).optional(),
})

const GitHubFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  sha: z.string().optional(),
  size: z.number().optional(),
  type: z.enum(['file', 'dir', 'symlink', 'submodule']),
  html_url: z.string().nullable().optional(),
  download_url: z.string().nullable().optional(),
  content: z.string().optional(),
  encoding: z.string().optional(),
})

const GitHubSearchResultSchema = z.object({
  total_count: z.number().optional(),
  incomplete_results: z.boolean().optional(),
  items: z.array(z.unknown()).optional(),
})

type GitHubIssue = z.infer<typeof GitHubIssueSchema>
type GitHubPR = z.infer<typeof GitHubPRSchema>
type GitHubRepo = z.infer<typeof GitHubRepoSchema>
type GitHubCommit = z.infer<typeof GitHubCommitSchema>
type GitHubFile = z.infer<typeof GitHubFileSchema>

// ─── Helpers ───────────────────────────────────────────────────────────────────

function issueRole(issue: GitHubIssue): EnrichedNode['role'] {
  if (issue.state === 'closed') return 'decorative'
  const labels = issue.labels?.map((l) => l.name.toLowerCase()) ?? []
  if (labels.some((l) => l.includes('critical') || l.includes('blocker') || l.includes('p0'))) return 'primary'
  if (labels.some((l) => l.includes('bug') || l.includes('urgent') || l.includes('p1'))) return 'primary'
  if (labels.some((l) => l.includes('enhancement') || l.includes('feature'))) return 'secondary'
  return 'tertiary'
}

function commitSubject(message: string): string {
  return message.split('\n')[0].slice(0, 80)
}

function fileType(path: string): EnrichedNode['type'] {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const extMap: Record<string, EnrichedNode['type']> = {
    ts: 'BLOCK', tsx: 'BLOCK', js: 'BLOCK', jsx: 'BLOCK',
    md: 'PARAGRAPH', txt: 'PARAGRAPH',
    json: 'BLOCK', yaml: 'BLOCK', yml: 'BLOCK',
    css: 'BLOCK', scss: 'BLOCK',
    png: 'IMAGE', jpg: 'IMAGE', jpeg: 'IMAGE', svg: 'IMAGE', gif: 'IMAGE',
  }
  return extMap[ext] ?? 'BLOCK'
}

// ─── GitHub Adapter ────────────────────────────────────────────────────────────

export class GitHubAdapter implements EMCPAdapter {
  readonly name = 'github'
  readonly version = '1.0.0'

  private scorer = new ConfidenceScorer()

  canHandle(toolName: string, _response: unknown): boolean {
    return (
      toolName.includes('github') ||
      toolName.includes('get_issue') ||
      toolName.includes('get_pull') ||
      toolName.includes('list_issues') ||
      toolName.includes('list_pulls') ||
      toolName.includes('get_repo') ||
      toolName.includes('get_commit') ||
      toolName.includes('get_file_contents') ||
      toolName.includes('search_code') ||
      toolName.includes('search_issues') ||
      toolName.includes('list_commits')
    )
  }

  async parse(toolName: string, response: unknown): Promise<EnrichedNode[]> {
    const nodes: EnrichedNode[] = []

    // Search result wrapper
    const searchResult = GitHubSearchResultSchema.safeParse(response)
    if (searchResult.success && searchResult.data.items) {
      for (const item of searchResult.data.items) {
        const parsed = this.parseItem(item, toolName)
        if (parsed) nodes.push(parsed)
      }
      return nodes
    }

    // Array response
    if (Array.isArray(response)) {
      for (const item of response) {
        const parsed = this.parseItem(item, toolName)
        if (parsed) nodes.push(parsed)
      }
      return nodes
    }

    // Single item
    const parsed = this.parseItem(response, toolName)
    if (parsed) nodes.push(parsed)

    return nodes
  }

  private parseItem(item: unknown, toolName: string): EnrichedNode | null {
    // PR (must check before issue since PR extends issue shape)
    const prResult = GitHubPRSchema.safeParse(item)
    if (prResult.success && prResult.data.head !== undefined) {
      return this.parsePR(prResult.data)
    }

    // Issue
    const issueResult = GitHubIssueSchema.safeParse(item)
    if (issueResult.success && issueResult.data.number !== undefined) {
      return this.parseIssue(issueResult.data)
    }

    // Repo
    const repoResult = GitHubRepoSchema.safeParse(item)
    if (repoResult.success && repoResult.data.full_name) {
      return this.parseRepo(repoResult.data)
    }

    // Commit
    const commitResult = GitHubCommitSchema.safeParse(item)
    if (commitResult.success && commitResult.data.sha && commitResult.data.commit) {
      return this.parseCommit(commitResult.data)
    }

    // File
    const fileResult = GitHubFileSchema.safeParse(item)
    if (fileResult.success && fileResult.data.path) {
      return this.parseFile(fileResult.data)
    }

    return null
  }

  private parseIssue(issue: GitHubIssue): EnrichedNode {
    const isPR = !!issue.pull_request
    const labelNames = issue.labels?.map((l) => l.name) ?? []
    const labelColors = issue.labels?.map((l) => l.color).filter(Boolean) ?? []

    const description = [
      issue.user?.login ? `by @${issue.user.login}` : null,
      issue.assignee?.login ? `assigned to @${issue.assignee.login}` : null,
      labelNames.length > 0 ? `labels: ${labelNames.join(', ')}` : null,
      issue.milestone?.title ? `milestone: ${issue.milestone.title}` : null,
      issue.comments !== undefined ? `${issue.comments} comments` : null,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.93,
      styleFromApi: labelColors.length > 0,
      hasChildren: (issue.comments ?? 0) > 0,
      hasParent: false,
    })

    return {
      id: `github:issue:${issue.id}`,
      name: `#${issue.number} ${issue.title}`,
      schema: EMCP_SCHEMA_VERSION,
      source: 'github',
      sourceId: String(issue.id),
      type: isPR ? 'BLOCK' : 'BLOCK',
      role: issueRole(issue),
      label: issue.title,
      description,
      parentId: undefined,
      children: [],
      depth: 0,
      confidence,
      style: labelColors.length > 0 ? { fill: `#${labelColors[0]}` } : undefined,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      raw: {
        ...issue,
        _isPR: isPR,
        _isOpen: issue.state === 'open',
        _labelNames: labelNames,
        _assignees: issue.assignees?.map((a) => a.login) ?? [],
        _reactionCount: issue.reactions?.total_count ?? 0,
        _upvotes: issue.reactions?.['+1'] ?? 0,
      } as unknown as Record<string, unknown>,
    }
  }

  private parsePR(pr: GitHubPR): EnrichedNode {
    const labelNames = pr.labels?.map((l) => l.name) ?? []

    const description = [
      pr.user?.login ? `by @${pr.user.login}` : null,
      pr.head && pr.base ? `${pr.head.ref} → ${pr.base.ref}` : null,
      pr.additions !== undefined ? `+${pr.additions} -${pr.deletions}` : null,
      pr.changed_files !== undefined ? `${pr.changed_files} files` : null,
      pr.commits !== undefined ? `${pr.commits} commits` : null,
      pr.merged ? 'Merged' : pr.state === 'closed' ? 'Closed' : 'Open',
      pr.draft ? 'Draft' : null,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.95,
      styleFromApi: false,
      hasChildren: (pr.commits ?? 0) > 0,
      hasParent: false,
    })

    return {
      id: `github:pr:${pr.id}`,
      name: `PR #${pr.number} ${pr.title}`,
      schema: EMCP_SCHEMA_VERSION,
      source: 'github',
      sourceId: String(pr.id),
      type: 'BLOCK',
      role: pr.merged ? 'decorative' : pr.draft ? 'tertiary' : issueRole(pr),
      label: pr.title,
      description,
      parentId: undefined,
      children: [],
      depth: 0,
      confidence,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      raw: {
        ...pr,
        _isMerged: pr.merged ?? false,
        _isDraft: pr.draft ?? false,
        _isOpen: pr.state === 'open',
        _labelNames: labelNames,
        _reviewers: pr.requested_reviewers?.map((r) => r.login) ?? [],
        _branch: pr.head?.ref ?? null,
        _targetBranch: pr.base?.ref ?? null,
      } as unknown as Record<string, unknown>,
    }
  }

  private parseRepo(repo: GitHubRepo): EnrichedNode {
    const description = [
      repo.description,
      repo.language ? `Language: ${repo.language}` : null,
      repo.stargazers_count !== undefined ? `⭐ ${repo.stargazers_count}` : null,
      repo.forks_count !== undefined ? `🍴 ${repo.forks_count}` : null,
      repo.open_issues_count !== undefined ? `${repo.open_issues_count} open issues` : null,
      repo.license?.name ? `License: ${repo.license.name}` : null,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.97,
      styleFromApi: false,
      hasChildren: true,
      hasParent: false,
    })

    return {
      id: `github:repo:${repo.id}`,
      name: repo.full_name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'github',
      sourceId: String(repo.id),
      type: 'CONTAINER',
      role: 'structural',
      label: repo.name,
      description,
      parentId: undefined,
      children: [],
      depth: 0,
      confidence,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      raw: {
        ...repo,
        _isPrivate: repo.private ?? false,
        _isArchived: repo.archived ?? false,
        _topics: repo.topics ?? [],
        _defaultBranch: repo.default_branch ?? 'main',
        _sizeKb: repo.size ?? 0,
      } as unknown as Record<string, unknown>,
    }
  }

  private parseCommit(commit: GitHubCommit): EnrichedNode {
    const subject = commitSubject(commit.commit.message)
    const author = commit.commit.author?.name ?? commit.author?.login ?? 'Unknown'

    const description = [
      `by ${author}`,
      commit.commit.author?.date ? new Date(commit.commit.author.date).toLocaleDateString() : null,
      commit.stats ? `+${commit.stats.additions} -${commit.stats.deletions}` : null,
      commit.files ? `${commit.files.length} files changed` : null,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.9,
      styleFromApi: false,
      hasChildren: (commit.files?.length ?? 0) > 0,
      hasParent: false,
    })

    return {
      id: `github:commit:${commit.sha}`,
      name: subject,
      schema: EMCP_SCHEMA_VERSION,
      source: 'github',
      sourceId: commit.sha,
      type: 'BLOCK',
      role: 'structural',
      label: subject,
      description,
      parentId: undefined,
      children: commit.files?.map((f) => `github:file:${f.filename}`) ?? [],
      depth: 0,
      confidence,
      createdAt: commit.commit.author?.date,
      raw: {
        ...commit,
        _shortSha: commit.sha.slice(0, 7),
        _author: author,
        _filesChanged: commit.files?.map((f) => f.filename) ?? [],
        _additions: commit.stats?.additions ?? 0,
        _deletions: commit.stats?.deletions ?? 0,
      } as unknown as Record<string, unknown>,
    }
  }

  private parseFile(file: GitHubFile): EnrichedNode {
    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.88,
      styleFromApi: false,
      hasChildren: file.type === 'dir',
      hasParent: true,
    })

    return {
      id: `github:file:${file.path}`,
      name: file.name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'github',
      sourceId: file.sha ?? file.path,
      type: file.type === 'dir' ? 'CONTAINER' : fileType(file.path),
      role: 'structural',
      label: file.path,
      description: file.size !== undefined ? `${Math.round(file.size / 1024 * 10) / 10} KB` : undefined,
      parentId: undefined,
      children: [],
      depth: file.path.split('/').length - 1,
      confidence,
      raw: {
        ...file,
        _isDirectory: file.type === 'dir',
        _extension: file.name.split('.').pop() ?? '',
        _hasContent: !!file.content,
      } as unknown as Record<string, unknown>,
    }
  }
}
