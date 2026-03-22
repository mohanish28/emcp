import { z } from 'zod'
import type { EMCPAdapter, EnrichedNode } from '../../core/types.js'
import { EMCP_SCHEMA_VERSION } from '../../core/types.js'
import { SemanticTagger } from '../../enrichment/tagger.js'
import { ConfidenceScorer } from '../../enrichment/scorer.js'

// ─── Asana API shapes ──────────────────────────────────────────────────────────

const AsanaUserSchema = z.object({
  gid: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  resource_type: z.literal('user').optional(),
})

const AsanaTagSchema = z.object({
  gid: z.string(),
  name: z.string().optional(),
})

const AsanaCustomFieldSchema = z.object({
  gid: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  display_value: z.string().nullable().optional(),
  number_value: z.number().nullable().optional(),
  text_value: z.string().nullable().optional(),
  enum_value: z.object({ name: z.string() }).nullable().optional(),
})

const AsanaTaskSchema = z.object({
  gid: z.string(),
  resource_type: z.literal('task').optional(),
  name: z.string().optional(),
  notes: z.string().optional(),
  html_notes: z.string().optional(),
  completed: z.boolean().optional(),
  completed_at: z.string().nullable().optional(),
  due_on: z.string().nullable().optional(),
  due_at: z.string().nullable().optional(),
  start_on: z.string().nullable().optional(),
  created_at: z.string().optional(),
  modified_at: z.string().optional(),
  assignee: AsanaUserSchema.nullable().optional(),
  assignee_status: z.string().optional(),
  followers: z.array(AsanaUserSchema).optional(),
  tags: z.array(AsanaTagSchema).optional(),
  custom_fields: z.array(AsanaCustomFieldSchema).optional(),
  num_subtasks: z.number().optional(),
  num_likes: z.number().optional(),
  liked: z.boolean().optional(),
  permalink_url: z.string().optional(),
  parent: z.object({ gid: z.string(), name: z.string().optional() }).nullable().optional(),
  projects: z.array(z.object({ gid: z.string(), name: z.string().optional() })).optional(),
  memberships: z.array(z.object({
    project: z.object({ gid: z.string(), name: z.string().optional() }).optional(),
    section: z.object({ gid: z.string(), name: z.string().optional() }).optional(),
  })).optional(),
})

const AsanaProjectSchema = z.object({
  gid: z.string(),
  resource_type: z.literal('project').optional(),
  name: z.string().optional(),
  notes: z.string().optional(),
  color: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  public: z.boolean().optional(),
  created_at: z.string().optional(),
  modified_at: z.string().optional(),
  due_on: z.string().nullable().optional(),
  start_on: z.string().nullable().optional(),
  current_status: z.object({
    color: z.string().optional(),
    text: z.string().optional(),
    title: z.string().optional(),
  }).optional(),
  num_tasks: z.number().optional(),
  permalink_url: z.string().optional(),
  owner: AsanaUserSchema.nullable().optional(),
  team: z.object({ gid: z.string(), name: z.string().optional() }).nullable().optional(),
  members: z.array(AsanaUserSchema).optional(),
})

const AsanaSectionSchema = z.object({
  gid: z.string(),
  resource_type: z.literal('section').optional(),
  name: z.string().optional(),
  created_at: z.string().optional(),
  project: z.object({ gid: z.string(), name: z.string().optional() }).optional(),
})

const AsanaWorkspaceSchema = z.object({
  gid: z.string(),
  resource_type: z.literal('workspace').optional(),
  name: z.string().optional(),
  is_organization: z.boolean().optional(),
})

const AsanaResponseSchema = z.object({
  data: z.union([
    z.array(z.unknown()),
    z.unknown(),
  ]).optional(),
  next_page: z.object({ offset: z.string(), uri: z.string() }).nullable().optional(),
})

type AsanaTask = z.infer<typeof AsanaTaskSchema>
type AsanaProject = z.infer<typeof AsanaProjectSchema>
type AsanaSection = z.infer<typeof AsanaSectionSchema>
type AsanaWorkspace = z.infer<typeof AsanaWorkspaceSchema>

// ─── Helpers ───────────────────────────────────────────────────────────────────

function taskPriority(task: AsanaTask): EnrichedNode['role'] {
  if (task.completed) return 'decorative'
  if (!task.due_on && !task.due_at) return 'unknown'

  const due = new Date(task.due_on ?? task.due_at ?? '')
  const now = new Date()
  const daysUntilDue = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)

  if (daysUntilDue < 0) return 'primary'      // overdue
  if (daysUntilDue <= 2) return 'primary'     // due very soon
  if (daysUntilDue <= 7) return 'secondary'   // due this week
  return 'tertiary'
}

function extractCustomFieldSummary(fields?: AsanaTask['custom_fields']): string | undefined {
  if (!fields || fields.length === 0) return undefined
  return fields
    .filter((f) => f.display_value)
    .map((f) => `${f.name}: ${f.display_value}`)
    .join(', ')
}

// ─── Asana Adapter ─────────────────────────────────────────────────────────────

export class AsanaAdapter implements EMCPAdapter {
  readonly name = 'asana'
  readonly version = '1.0.0'

  private tagger = new SemanticTagger()
  private scorer = new ConfidenceScorer()

  canHandle(toolName: string, _response: unknown): boolean {
    return (
      toolName.includes('asana') ||
      toolName.includes('get_task') ||
      toolName.includes('get_project') ||
      toolName.includes('get_tasks') ||
      toolName.includes('list_tasks') ||
      toolName.includes('search_tasks') ||
      toolName.includes('get_sections') ||
      toolName.includes('get_workspaces')
    )
  }

  async parse(_toolName: string, response: unknown): Promise<EnrichedNode[]> {
    const nodes: EnrichedNode[] = []

    // Try standard Asana { data: [...] } wrapper
    const wrapped = AsanaResponseSchema.safeParse(response)
    if (wrapped.success && wrapped.data.data !== undefined) {
      const items = Array.isArray(wrapped.data.data)
        ? wrapped.data.data
        : [wrapped.data.data]

      for (const item of items) {
        const parsed = this.parseItem(item, undefined, 0)
        if (parsed) nodes.push(parsed)
      }
      return nodes
    }

    // Try direct item
    const direct = this.parseItem(response, undefined, 0)
    if (direct) nodes.push(direct)

    // Try raw array
    if (Array.isArray(response)) {
      for (const item of response) {
        const parsed = this.parseItem(item, undefined, 0)
        if (parsed) nodes.push(parsed)
      }
    }

    return nodes
  }

  private parseItem(
    item: unknown,
    parentId: string | undefined,
    depth: number
  ): EnrichedNode | null {
    const taskResult = AsanaTaskSchema.safeParse(item)
    if (taskResult.success) return this.parseTask(taskResult.data, parentId, depth)

    const projectResult = AsanaProjectSchema.safeParse(item)
    if (projectResult.success) return this.parseProject(projectResult.data, parentId, depth)

    const sectionResult = AsanaSectionSchema.safeParse(item)
    if (sectionResult.success) return this.parseSection(sectionResult.data, parentId, depth)

    const workspaceResult = AsanaWorkspaceSchema.safeParse(item)
    if (workspaceResult.success) return this.parseWorkspace(workspaceResult.data)

    return null
  }

  private parseTask(task: AsanaTask, parentId: string | undefined, depth: number): EnrichedNode {
    const name = task.name ?? 'Untitled Task'
    const customFieldSummary = extractCustomFieldSummary(task.custom_fields)

    const description = [
      task.assignee?.name ? `Assigned to: ${task.assignee.name}` : null,
      task.due_on ? `Due: ${task.due_on}` : null,
      task.completed ? 'Completed' : null,
      task.num_subtasks ? `${task.num_subtasks} subtasks` : null,
      customFieldSummary,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.92,
      styleFromApi: false,
      hasChildren: (task.num_subtasks ?? 0) > 0,
      hasParent: parentId !== undefined || task.parent !== null,
    })

    return {
      id: `asana:task:${task.gid}`,
      name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'asana',
      sourceId: task.gid,
      type: 'BLOCK',
      role: taskPriority(task),
      label: name,
      description,
      parentId: parentId ?? (task.parent?.gid ? `asana:task:${task.parent.gid}` : undefined),
      children: [],
      depth,
      confidence,
      createdAt: task.created_at,
      updatedAt: task.modified_at,
      raw: {
        ...task,
        _completed: task.completed ?? false,
        _overdue: (() => {
          if (!task.due_on || task.completed) return false
          return new Date(task.due_on) < new Date()
        })(),
        _assigneeName: task.assignee?.name ?? null,
        _projectNames: task.projects?.map((p) => p.name).filter(Boolean) ?? [],
        _sectionName: task.memberships?.[0]?.section?.name ?? null,
        _tags: task.tags?.map((t) => t.name).filter(Boolean) ?? [],
        _customFields: task.custom_fields ?? [],
      } as unknown as Record<string, unknown>,
    }
  }

  private parseProject(project: AsanaProject, parentId: string | undefined, depth: number): EnrichedNode {
    const name = project.name ?? 'Untitled Project'

    const statusColor = project.current_status?.color
    const statusText = project.current_status?.title ?? project.current_status?.text

    const description = [
      project.owner?.name ? `Owner: ${project.owner.name}` : null,
      project.team?.name ? `Team: ${project.team.name}` : null,
      project.due_on ? `Due: ${project.due_on}` : null,
      statusText ? `Status: ${statusText}` : null,
      project.num_tasks !== undefined ? `${project.num_tasks} tasks` : null,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.95,
      styleFromApi: !!project.color,
      hasChildren: true,
      hasParent: parentId !== undefined,
    })

    return {
      id: `asana:project:${project.gid}`,
      name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'asana',
      sourceId: project.gid,
      type: 'CONTAINER',
      role: 'structural',
      label: name,
      description,
      parentId,
      children: [],
      depth,
      confidence,
      style: project.color ? { fill: project.color } : undefined,
      createdAt: project.created_at,
      updatedAt: project.modified_at,
      raw: {
        ...project,
        _statusColor: statusColor ?? null,
        _statusText: statusText ?? null,
        _memberCount: project.members?.length ?? 0,
        _isArchived: project.archived ?? false,
      } as unknown as Record<string, unknown>,
    }
  }

  private parseSection(section: AsanaSection, parentId: string | undefined, depth: number): EnrichedNode {
    const name = section.name ?? 'Untitled Section'

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.9,
      styleFromApi: false,
      hasChildren: true,
      hasParent: parentId !== undefined || !!section.project,
    })

    return {
      id: `asana:section:${section.gid}`,
      name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'asana',
      sourceId: section.gid,
      type: 'SECTION',
      role: 'structural',
      label: name,
      parentId: parentId ?? (section.project?.gid ? `asana:project:${section.project.gid}` : undefined),
      children: [],
      depth,
      confidence,
      createdAt: section.created_at,
      raw: section as unknown as Record<string, unknown>,
    }
  }

  private parseWorkspace(workspace: AsanaWorkspace): EnrichedNode {
    const name = workspace.name ?? 'Untitled Workspace'

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.95,
      styleFromApi: false,
      hasChildren: true,
      hasParent: false,
    })

    return {
      id: `asana:workspace:${workspace.gid}`,
      name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'asana',
      sourceId: workspace.gid,
      type: 'CONTAINER',
      role: 'structural',
      label: name,
      description: workspace.is_organization ? 'Organization workspace' : 'Personal workspace',
      parentId: undefined,
      children: [],
      depth: 0,
      confidence,
      raw: workspace as unknown as Record<string, unknown>,
    }
  }
}
