import { z } from 'zod'
import type { EMCPAdapter, EnrichedNode } from '../../core/types.js'
import { EMCP_SCHEMA_VERSION } from '../../core/types.js'
import { ConfidenceScorer } from '../../enrichment/scorer.js'

// ─── Linear API shapes ─────────────────────────────────────────────────────────

const LinearUserSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  displayName: z.string().optional(),
  avatarUrl: z.string().optional(),
})

const LinearTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string().optional(),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  timezone: z.string().optional(),
  issueCount: z.number().optional(),
})

const LinearLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
})

const LinearStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'cancelled']),
  color: z.string().optional(),
  position: z.number().optional(),
})

const LinearProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  state: z.enum(['planned', 'started', 'paused', 'completed', 'cancelled']).optional(),
  color: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  progress: z.number().optional(),
  startDate: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lead: LinearUserSchema.optional().nullable(),
  members: z.object({ nodes: z.array(LinearUserSchema) }).optional(),
  teams: z.object({ nodes: z.array(LinearTeamSchema) }).optional(),
  issueCount: z.number().optional(),
  completedIssueCount: z.number().optional(),
  url: z.string().optional(),
})

const LinearIssueSchema = z.object({
  id: z.string(),
  identifier: z.string().optional(),   // e.g. "ENG-123"
  title: z.string(),
  description: z.string().nullable().optional(),
  priority: z.number().min(0).max(4).optional(),   // 0=no, 1=urgent, 2=high, 3=medium, 4=low
  priorityLabel: z.string().optional(),
  state: LinearStateSchema.optional(),
  assignee: LinearUserSchema.nullable().optional(),
  creator: LinearUserSchema.optional(),
  team: LinearTeamSchema.optional(),
  project: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  cycle: z.object({ id: z.string(), name: z.string().optional(), number: z.number().optional() }).nullable().optional(),
  labels: z.object({ nodes: z.array(LinearLabelSchema) }).optional(),
  parent: z.object({ id: z.string(), title: z.string().optional(), identifier: z.string().optional() }).nullable().optional(),
  children: z.object({ nodes: z.array(z.object({ id: z.string() })) }).optional(),
  estimate: z.number().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  cancelledAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  url: z.string().optional(),
  branchName: z.string().optional(),
  comments: z.object({ totalCount: z.number() }).optional(),
  reactions: z.array(z.object({ emoji: z.string() })).optional(),
  sortOrder: z.number().optional(),
})

const LinearCycleSchema = z.object({
  id: z.string(),
  number: z.number().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  completedAt: z.string().nullable().optional(),
  progress: z.number().optional(),
  issueCount: z.number().optional(),
  completedIssueCount: z.number().optional(),
  team: LinearTeamSchema.optional(),
})

// GraphQL connection wrapper
const LinearConnectionSchema = z.object({
  nodes: z.array(z.unknown()).optional(),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }).optional(),
})

type LinearIssue = z.infer<typeof LinearIssueSchema>
type LinearProject = z.infer<typeof LinearProjectSchema>
type LinearTeam = z.infer<typeof LinearTeamSchema>
type LinearCycle = z.infer<typeof LinearCycleSchema>

// ─── Helpers ───────────────────────────────────────────────────────────────────

function priorityToRole(priority?: number): EnrichedNode['role'] {
  switch (priority) {
    case 1: return 'primary'    // urgent
    case 2: return 'primary'    // high
    case 3: return 'secondary'  // medium
    case 4: return 'tertiary'   // low
    default: return 'unknown'   // no priority
  }
}

function stateToRole(state?: LinearIssue['state']): EnrichedNode['role'] {
  if (!state) return 'unknown'
  switch (state.type) {
    case 'completed': return 'decorative'
    case 'cancelled': return 'decorative'
    case 'started': return 'secondary'
    case 'triage': return 'primary'
    default: return 'tertiary'
  }
}

function resolveRole(issue: LinearIssue): EnrichedNode['role'] {
  if (issue.completedAt || issue.cancelledAt) return 'decorative'
  if (issue.priority !== undefined && issue.priority > 0) return priorityToRole(issue.priority)
  return stateToRole(issue.state)
}

function projectProgress(p: LinearProject): string | undefined {
  if (p.progress === undefined) return undefined
  return `${Math.round(p.progress * 100)}% complete`
}

// ─── Linear Adapter ────────────────────────────────────────────────────────────

export class LinearAdapter implements EMCPAdapter {
  readonly name = 'linear'
  readonly version = '1.0.0'

  private scorer = new ConfidenceScorer()

  canHandle(toolName: string, _response: unknown): boolean {
    return (
      toolName.includes('linear') ||
      toolName.includes('get_issue') ||
      toolName.includes('list_issues') ||
      toolName.includes('get_project') ||
      toolName.includes('list_projects') ||
      toolName.includes('get_team') ||
      toolName.includes('get_cycle') ||
      toolName.includes('search_issues')
    )
  }

  async parse(_toolName: string, response: unknown): Promise<EnrichedNode[]> {
    const nodes: EnrichedNode[] = []

    // GraphQL connection response
    const connResult = LinearConnectionSchema.safeParse(response)
    if (connResult.success && connResult.data.nodes) {
      for (const item of connResult.data.nodes) {
        const parsed = this.parseItem(item)
        if (parsed) nodes.push(parsed)
      }
      return nodes
    }

    // Array
    if (Array.isArray(response)) {
      for (const item of response) {
        const parsed = this.parseItem(item)
        if (parsed) nodes.push(parsed)
      }
      return nodes
    }

    // Single item
    const parsed = this.parseItem(response)
    if (parsed) nodes.push(parsed)

    return nodes
  }

  private parseItem(item: unknown): EnrichedNode | null {
    // Issue — most specific check first (has 'title' + 'state')
    const issueResult = LinearIssueSchema.safeParse(item)
    if (issueResult.success && issueResult.data.title !== undefined) {
      return this.parseIssue(issueResult.data)
    }

    // Project
    const projectResult = LinearProjectSchema.safeParse(item)
    if (projectResult.success && projectResult.data.name && projectResult.data.state !== undefined) {
      return this.parseProject(projectResult.data)
    }

    // Cycle
    const cycleResult = LinearCycleSchema.safeParse(item)
    if (cycleResult.success && cycleResult.data.startsAt !== undefined) {
      return this.parseCycle(cycleResult.data)
    }

    // Team
    const teamResult = LinearTeamSchema.safeParse(item)
    if (teamResult.success && teamResult.data.key !== undefined) {
      return this.parseTeam(teamResult.data)
    }

    return null
  }

  private parseIssue(issue: LinearIssue): EnrichedNode {
    const identifier = issue.identifier ? `${issue.identifier} ` : ''
    const name = `${identifier}${issue.title}`
    const labelNames = issue.labels?.nodes.map((l) => l.name) ?? []
    const labelColor = issue.labels?.nodes[0]?.color

    const description = [
      issue.state?.name ? `State: ${issue.state.name}` : null,
      issue.priorityLabel ? `Priority: ${issue.priorityLabel}` : null,
      issue.assignee?.name ? `Assignee: ${issue.assignee.name}` : null,
      issue.project?.name ? `Project: ${issue.project.name}` : null,
      issue.cycle?.number !== undefined ? `Cycle ${issue.cycle.number}` : null,
      issue.estimate !== undefined && issue.estimate !== null ? `${issue.estimate} pts` : null,
      issue.dueDate ? `Due: ${issue.dueDate}` : null,
      labelNames.length > 0 ? labelNames.join(', ') : null,
      issue.comments?.totalCount ? `${issue.comments.totalCount} comments` : null,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.94,
      styleFromApi: !!labelColor || !!issue.state?.color,
      hasChildren: (issue.children?.nodes.length ?? 0) > 0,
      hasParent: !!issue.parent,
    })

    return {
      id: `linear:issue:${issue.id}`,
      name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'linear',
      sourceId: issue.id,
      type: 'BLOCK',
      role: resolveRole(issue),
      label: issue.title,
      description,
      parentId: issue.parent?.id ? `linear:issue:${issue.parent.id}` : undefined,
      children: issue.children?.nodes.map((c) => `linear:issue:${c.id}`) ?? [],
      depth: issue.parent ? 1 : 0,
      confidence,
      style: labelColor ? { fill: labelColor } : issue.state?.color ? { fill: issue.state.color } : undefined,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      raw: {
        ...issue,
        _identifier: issue.identifier ?? null,
        _priority: issue.priority ?? 0,
        _priorityLabel: issue.priorityLabel ?? 'No priority',
        _stateName: issue.state?.name ?? null,
        _stateType: issue.state?.type ?? null,
        _assigneeName: issue.assignee?.name ?? null,
        _teamName: issue.team?.name ?? null,
        _projectName: issue.project?.name ?? null,
        _cycleNumber: issue.cycle?.number ?? null,
        _labelNames: labelNames,
        _branchName: issue.branchName ?? null,
        _isCompleted: !!issue.completedAt,
        _isCancelled: !!issue.cancelledAt,
        _estimate: issue.estimate ?? null,
      } as unknown as Record<string, unknown>,
    }
  }

  private parseProject(project: LinearProject): EnrichedNode {
    const memberCount = project.members?.nodes.length ?? 0
    const progress = projectProgress(project)

    const description = [
      project.state ? `State: ${project.state}` : null,
      progress,
      project.lead?.name ? `Lead: ${project.lead.name}` : null,
      project.targetDate ? `Target: ${project.targetDate}` : null,
      project.issueCount !== undefined ? `${project.issueCount} issues` : null,
      memberCount > 0 ? `${memberCount} members` : null,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.96,
      styleFromApi: !!project.color,
      hasChildren: true,
      hasParent: false,
    })

    return {
      id: `linear:project:${project.id}`,
      name: project.name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'linear',
      sourceId: project.id,
      type: 'CONTAINER',
      role: project.state === 'completed' || project.state === 'cancelled' ? 'decorative' : 'structural',
      label: project.name,
      description,
      parentId: undefined,
      children: [],
      depth: 0,
      confidence,
      style: project.color ? { fill: project.color } : undefined,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      raw: {
        ...project,
        _state: project.state ?? null,
        _progress: project.progress ?? null,
        _leadName: project.lead?.name ?? null,
        _issueCount: project.issueCount ?? 0,
        _completedIssueCount: project.completedIssueCount ?? 0,
      } as unknown as Record<string, unknown>,
    }
  }

  private parseCycle(cycle: LinearCycle): EnrichedNode {
    const name = cycle.name ?? `Cycle ${cycle.number ?? cycle.id}`
    const isActive = cycle.startsAt && !cycle.completedAt
      ? new Date(cycle.startsAt) <= new Date() && (!cycle.endsAt || new Date(cycle.endsAt) >= new Date())
      : false

    const description = [
      cycle.startsAt ? `Starts: ${cycle.startsAt.slice(0, 10)}` : null,
      cycle.endsAt ? `Ends: ${cycle.endsAt.slice(0, 10)}` : null,
      cycle.progress !== undefined ? `${Math.round(cycle.progress * 100)}% complete` : null,
      cycle.issueCount !== undefined ? `${cycle.issueCount} issues` : null,
      isActive ? 'Active' : null,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.92,
      styleFromApi: false,
      hasChildren: true,
      hasParent: false,
    })

    return {
      id: `linear:cycle:${cycle.id}`,
      name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'linear',
      sourceId: cycle.id,
      type: 'CONTAINER',
      role: cycle.completedAt ? 'decorative' : isActive ? 'primary' : 'secondary',
      label: name,
      description,
      parentId: cycle.team?.id ? `linear:team:${cycle.team.id}` : undefined,
      children: [],
      depth: cycle.team ? 1 : 0,
      confidence,
      createdAt: cycle.startsAt,
      raw: {
        ...cycle,
        _isActive: isActive,
        _isCompleted: !!cycle.completedAt,
        _teamName: cycle.team?.name ?? null,
      } as unknown as Record<string, unknown>,
    }
  }

  private parseTeam(team: LinearTeam): EnrichedNode {
    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.97,
      styleFromApi: !!team.color,
      hasChildren: true,
      hasParent: false,
    })

    return {
      id: `linear:team:${team.id}`,
      name: team.name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'linear',
      sourceId: team.id,
      type: 'CONTAINER',
      role: 'structural',
      label: team.name,
      description: [
        team.key ? `Key: ${team.key}` : null,
        team.description,
        team.issueCount !== undefined ? `${team.issueCount} issues` : null,
      ].filter(Boolean).join(' · ') || undefined,
      parentId: undefined,
      children: [],
      depth: 0,
      confidence,
      style: team.color ? { fill: team.color } : undefined,
      raw: team as unknown as Record<string, unknown>,
    }
  }
}
