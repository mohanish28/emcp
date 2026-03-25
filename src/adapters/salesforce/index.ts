import { z } from 'zod'
import type { EMCPAdapter, EnrichedNode } from '../../core/types.js'
import { EMCP_SCHEMA_VERSION } from '../../core/types.js'
import { ConfidenceScorer } from '../../enrichment/scorer.js'

// ─── Salesforce field shapes ───────────────────────────────────────────────────

const SFAddressSchema = z.object({
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
})

const SFReferenceSchema = z.object({
  Id: z.string().optional(),
  Name: z.string().optional(),
  attributes: z.object({ type: z.string() }).optional(),
})

// ─── Salesforce object schemas ────────────────────────────────────────────────

const SFBaseSchema = z.object({
  Id: z.string(),
  attributes: z.object({
    type: z.string(),
    url: z.string().optional(),
  }).optional(),
  CreatedDate: z.string().optional(),
  LastModifiedDate: z.string().optional(),
  Name: z.string().optional(),
  OwnerId: z.string().optional(),
  Owner: SFReferenceSchema.optional(),
})

const SFAccountSchema = SFBaseSchema.extend({
  Type: z.string().nullable().optional(),
  Industry: z.string().nullable().optional(),
  AnnualRevenue: z.number().nullable().optional(),
  NumberOfEmployees: z.number().nullable().optional(),
  Phone: z.string().nullable().optional(),
  Website: z.string().nullable().optional(),
  BillingAddress: SFAddressSchema.optional(),
  Description: z.string().nullable().optional(),
  Rating: z.string().nullable().optional(),
})

const SFContactSchema = SFBaseSchema.extend({
  FirstName: z.string().nullable().optional(),
  LastName: z.string().optional(),
  Email: z.string().nullable().optional(),
  Phone: z.string().nullable().optional(),
  MobilePhone: z.string().nullable().optional(),
  Title: z.string().nullable().optional(),
  Department: z.string().nullable().optional(),
  AccountId: z.string().nullable().optional(),
  Account: SFReferenceSchema.optional(),
  LeadSource: z.string().nullable().optional(),
  MailingAddress: SFAddressSchema.optional(),
})

const SFOpportunitySchema = SFBaseSchema.extend({
  StageName: z.string(),
  Amount: z.number().nullable().optional(),
  CloseDate: z.string(),
  Probability: z.number().nullable().optional(),
  Type: z.string().nullable().optional(),
  LeadSource: z.string().nullable().optional(),
  IsClosed: z.boolean().optional(),
  IsWon: z.boolean().optional(),
  AccountId: z.string().nullable().optional(),
  Account: SFReferenceSchema.optional(),
  NextStep: z.string().nullable().optional(),
  Description: z.string().nullable().optional(),
  ForecastCategory: z.string().nullable().optional(),
})

const SFCaseSchema = SFBaseSchema.extend({
  CaseNumber: z.string().optional(),
  Subject: z.string().optional(),
  Description: z.string().nullable().optional(),
  Status: z.string().optional(),
  Priority: z.string().optional(),
  Origin: z.string().nullable().optional(),
  Type: z.string().nullable().optional(),
  Reason: z.string().nullable().optional(),
  IsEscalated: z.boolean().optional(),
  IsClosed: z.boolean().optional(),
  AccountId: z.string().nullable().optional(),
  Account: SFReferenceSchema.optional(),
  ContactId: z.string().nullable().optional(),
  Contact: SFReferenceSchema.optional(),
})

const SFLeadSchema = SFBaseSchema.extend({
  FirstName: z.string().nullable().optional(),
  LastName: z.string().optional(),
  Email: z.string().nullable().optional(),
  Phone: z.string().nullable().optional(),
  Company: z.string().nullable().optional(),
  Title: z.string().nullable().optional(),
  Status: z.string().optional(),
  LeadSource: z.string().nullable().optional(),
  Industry: z.string().nullable().optional(),
  Rating: z.string().nullable().optional(),
  IsConverted: z.boolean().optional(),
  ConvertedDate: z.string().nullable().optional(),
  AnnualRevenue: z.number().nullable().optional(),
  NumberOfEmployees: z.number().nullable().optional(),
  Description: z.string().nullable().optional(),
})

const SFTaskSchema = SFBaseSchema.extend({
  Subject: z.string().optional(),
  Description: z.string().nullable().optional(),
  Status: z.string().optional(),
  Priority: z.string().optional(),
  ActivityDate: z.string().nullable().optional(),
  IsClosed: z.boolean().optional(),
  WhoId: z.string().nullable().optional(),
  WhatId: z.string().nullable().optional(),
  Type: z.string().nullable().optional(),
})

// Query result wrapper
const SFQueryResultSchema = z.object({
  totalSize: z.number().optional(),
  done: z.boolean().optional(),
  records: z.array(z.unknown()).optional(),
})

type SFAccount = z.infer<typeof SFAccountSchema>
type SFContact = z.infer<typeof SFContactSchema>
type SFOpportunity = z.infer<typeof SFOpportunitySchema>
type SFCase = z.infer<typeof SFCaseSchema>
type SFLead = z.infer<typeof SFLeadSchema>
type SFTask = z.infer<typeof SFTaskSchema>

// ─── Helpers ───────────────────────────────────────────────────────────────────

function oppRole(opp: SFOpportunity): EnrichedNode['role'] {
  if (opp.IsWon) return 'decorative'
  if (opp.IsClosed) return 'decorative'
  const prob = opp.Probability ?? 0
  if (prob >= 75) return 'primary'
  if (prob >= 40) return 'secondary'
  return 'tertiary'
}

function caseRole(c: SFCase): EnrichedNode['role'] {
  if (c.IsClosed) return 'decorative'
  if (c.IsEscalated) return 'primary'
  if (c.Priority === 'High') return 'primary'
  if (c.Priority === 'Medium') return 'secondary'
  return 'tertiary'
}

function formatCurrency(amount?: number | null): string | undefined {
  if (amount === undefined || amount === null) return undefined
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
}

// ─── Salesforce Adapter ────────────────────────────────────────────────────────

export class SalesforceAdapter implements EMCPAdapter {
  readonly name = 'salesforce'
  readonly version = '1.0.0'

  private scorer = new ConfidenceScorer()

  canHandle(toolName: string, _response: unknown): boolean {
    return (
      toolName.includes('salesforce') ||
      toolName.includes('sf_') ||
      toolName.includes('soql') ||
      toolName.includes('get_record') ||
      toolName.includes('get_opportunity') ||
      toolName.includes('get_contact') ||
      toolName.includes('get_account') ||
      toolName.includes('get_case') ||
      toolName.includes('get_lead') ||
      toolName.includes('query_records')
    )
  }

  async parse(_toolName: string, response: unknown): Promise<EnrichedNode[]> {
    const nodes: EnrichedNode[] = []

    // SOQL query result
    const queryResult = SFQueryResultSchema.safeParse(response)
    if (queryResult.success && queryResult.data.records) {
      for (const record of queryResult.data.records) {
        const parsed = this.parseRecord(record)
        if (parsed) nodes.push(parsed)
      }
      return nodes
    }

    // Array
    if (Array.isArray(response)) {
      for (const item of response) {
        const parsed = this.parseRecord(item)
        if (parsed) nodes.push(parsed)
      }
      return nodes
    }

    // Single record
    const parsed = this.parseRecord(response)
    if (parsed) nodes.push(parsed)

    return nodes
  }

  private parseRecord(item: unknown): EnrichedNode | null {
    // Detect type from attributes.type or by field shape
    const obj = item as Record<string, unknown>
    const sfType = (obj['attributes'] as Record<string, unknown> | undefined)?.['type'] as string | undefined

    if (sfType === 'Opportunity' || this.looksLikeOpportunity(obj)) {
      const r = SFOpportunitySchema.safeParse(item)
      if (r.success) return this.parseOpportunity(r.data)
    }
    if (sfType === 'Contact' || this.looksLikeContact(obj)) {
      const r = SFContactSchema.safeParse(item)
      if (r.success) return this.parseContact(r.data)
    }
    if (sfType === 'Account' || this.looksLikeAccount(obj)) {
      const r = SFAccountSchema.safeParse(item)
      if (r.success) return this.parseAccount(r.data)
    }
    if (sfType === 'Case') {
      const r = SFCaseSchema.safeParse(item)
      if (r.success) return this.parseCase(r.data)
    }
    if (sfType === 'Lead') {
      const r = SFLeadSchema.safeParse(item)
      if (r.success) return this.parseLead(r.data)
    }
    if (sfType === 'Task') {
      const r = SFTaskSchema.safeParse(item)
      if (r.success) return this.parseTask(r.data)
    }

    // Try each schema
    const oppR = SFOpportunitySchema.safeParse(item)
    if (oppR.success && oppR.data.StageName) return this.parseOpportunity(oppR.data)

    const caseR = SFCaseSchema.safeParse(item)
    if (caseR.success && caseR.data.CaseNumber) return this.parseCase(caseR.data)

    const leadR = SFLeadSchema.safeParse(item)
    if (leadR.success && leadR.data.IsConverted !== undefined) return this.parseLead(leadR.data)

    const contactR = SFContactSchema.safeParse(item)
    if (contactR.success && contactR.data.LastName) return this.parseContact(contactR.data)

    const accountR = SFAccountSchema.safeParse(item)
    if (accountR.success && accountR.data.Id) return this.parseAccount(accountR.data)

    return null
  }

  private looksLikeOpportunity(obj: Record<string, unknown>): boolean {
    return 'StageName' in obj || 'CloseDate' in obj
  }

  private looksLikeContact(obj: Record<string, unknown>): boolean {
    return 'LastName' in obj && 'AccountId' in obj
  }

  private looksLikeAccount(obj: Record<string, unknown>): boolean {
    return 'AnnualRevenue' in obj || 'NumberOfEmployees' in obj
  }

  private parseOpportunity(opp: SFOpportunity): EnrichedNode {
    const name = opp.Name ?? 'Untitled Opportunity'
    const amount = formatCurrency(opp.Amount)

    const description = [
      `Stage: ${opp.StageName}`,
      amount ? `Amount: ${amount}` : null,
      opp.Probability !== undefined ? `${opp.Probability}% probability` : null,
      `Close: ${opp.CloseDate}`,
      opp.Account?.Name ? `Account: ${opp.Account.Name}` : null,
      opp.IsWon ? 'Won' : opp.IsClosed ? 'Closed lost' : null,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.95,
      styleFromApi: false,
      hasChildren: false,
      hasParent: !!opp.AccountId,
    })

    return {
      id: `sf:opportunity:${opp.Id}`,
      name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'salesforce',
      sourceId: opp.Id,
      type: 'BLOCK',
      role: oppRole(opp),
      label: name,
      description,
      parentId: opp.AccountId ? `sf:account:${opp.AccountId}` : undefined,
      children: [],
      depth: opp.AccountId ? 1 : 0,
      confidence,
      createdAt: opp.CreatedDate,
      updatedAt: opp.LastModifiedDate,
      raw: {
        ...opp,
        _isWon: opp.IsWon ?? false,
        _isClosed: opp.IsClosed ?? false,
        _amount: opp.Amount ?? null,
        _probability: opp.Probability ?? null,
        _stage: opp.StageName,
        _accountName: opp.Account?.Name ?? null,
        _ownerName: opp.Owner?.Name ?? null,
      } as unknown as Record<string, unknown>,
    }
  }

  private parseContact(contact: SFContact): EnrichedNode {
    const fullName = [contact.FirstName, contact.LastName].filter(Boolean).join(' ') || 'Unknown Contact'

    const description = [
      contact.Title,
      contact.Department ? `Dept: ${contact.Department}` : null,
      contact.Email,
      contact.Phone ?? contact.MobilePhone,
      contact.Account?.Name ? `@ ${contact.Account.Name}` : null,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.94,
      styleFromApi: false,
      hasChildren: false,
      hasParent: !!contact.AccountId,
    })

    return {
      id: `sf:contact:${contact.Id}`,
      name: fullName,
      schema: EMCP_SCHEMA_VERSION,
      source: 'salesforce',
      sourceId: contact.Id,
      type: 'BLOCK',
      role: 'secondary',
      label: fullName,
      description,
      parentId: contact.AccountId ? `sf:account:${contact.AccountId}` : undefined,
      children: [],
      depth: contact.AccountId ? 1 : 0,
      confidence,
      createdAt: contact.CreatedDate,
      updatedAt: contact.LastModifiedDate,
      raw: {
        ...contact,
        _email: contact.Email ?? null,
        _phone: contact.Phone ?? contact.MobilePhone ?? null,
        _title: contact.Title ?? null,
        _accountName: contact.Account?.Name ?? null,
      } as unknown as Record<string, unknown>,
    }
  }

  private parseAccount(account: SFAccount): EnrichedNode {
    const name = account.Name ?? 'Unknown Account'
    const revenue = formatCurrency(account.AnnualRevenue)

    const description = [
      account.Industry,
      account.Type,
      revenue ? `Revenue: ${revenue}` : null,
      account.NumberOfEmployees ? `${account.NumberOfEmployees.toLocaleString()} employees` : null,
      account.Rating ? `Rating: ${account.Rating}` : null,
      account.Website,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.96,
      styleFromApi: false,
      hasChildren: true,
      hasParent: false,
    })

    return {
      id: `sf:account:${account.Id}`,
      name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'salesforce',
      sourceId: account.Id,
      type: 'CONTAINER',
      role: 'structural',
      label: name,
      description,
      parentId: undefined,
      children: [],
      depth: 0,
      confidence,
      createdAt: account.CreatedDate,
      updatedAt: account.LastModifiedDate,
      raw: {
        ...account,
        _industry: account.Industry ?? null,
        _type: account.Type ?? null,
        _annualRevenue: account.AnnualRevenue ?? null,
        _employees: account.NumberOfEmployees ?? null,
        _ownerName: account.Owner?.Name ?? null,
      } as unknown as Record<string, unknown>,
    }
  }

  private parseCase(c: SFCase): EnrichedNode {
    const name = c.Subject ?? `Case ${c.CaseNumber ?? c.Id}`

    const description = [
      c.CaseNumber ? `#${c.CaseNumber}` : null,
      `Status: ${c.Status}`,
      c.Priority ? `Priority: ${c.Priority}` : null,
      c.Origin ? `Origin: ${c.Origin}` : null,
      c.IsEscalated ? 'ESCALATED' : null,
      c.Account?.Name ? `Account: ${c.Account.Name}` : null,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.93,
      styleFromApi: false,
      hasChildren: false,
      hasParent: !!c.AccountId,
    })

    return {
      id: `sf:case:${c.Id}`,
      name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'salesforce',
      sourceId: c.Id,
      type: 'BLOCK',
      role: caseRole(c),
      label: name,
      description,
      parentId: c.AccountId ? `sf:account:${c.AccountId}` : undefined,
      children: [],
      depth: c.AccountId ? 1 : 0,
      confidence,
      createdAt: c.CreatedDate,
      updatedAt: c.LastModifiedDate,
      raw: {
        ...c,
        _isEscalated: c.IsEscalated ?? false,
        _isClosed: c.IsClosed ?? false,
        _priority: c.Priority ?? null,
        _status: c.Status ?? null,
        _caseNumber: c.CaseNumber ?? null,
      } as unknown as Record<string, unknown>,
    }
  }

  private parseLead(lead: SFLead): EnrichedNode {
    const fullName = [lead.FirstName, lead.LastName].filter(Boolean).join(' ') || 'Unknown Lead'

    const description = [
      lead.Company,
      lead.Title,
      lead.Email,
      `Status: ${lead.Status}`,
      lead.IsConverted ? 'Converted' : null,
      lead.Rating ? `Rating: ${lead.Rating}` : null,
    ].filter(Boolean).join(' · ') || undefined

    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.92,
      styleFromApi: false,
      hasChildren: false,
      hasParent: false,
    })

    return {
      id: `sf:lead:${lead.Id}`,
      name: fullName,
      schema: EMCP_SCHEMA_VERSION,
      source: 'salesforce',
      sourceId: lead.Id,
      type: 'BLOCK',
      role: lead.IsConverted ? 'decorative' : lead.Rating === 'Hot' ? 'primary' : 'secondary',
      label: fullName,
      description,
      parentId: undefined,
      children: [],
      depth: 0,
      confidence,
      createdAt: lead.CreatedDate,
      updatedAt: lead.LastModifiedDate,
      raw: {
        ...lead,
        _isConverted: lead.IsConverted ?? false,
        _status: lead.Status ?? null,
        _company: lead.Company ?? null,
        _email: lead.Email ?? null,
      } as unknown as Record<string, unknown>,
    }
  }

  private parseTask(task: SFTask): EnrichedNode {
    const name = task.Subject ?? 'Untitled Task'
    const confidence = this.scorer.score({
      spatialFromApi: false,
      semanticScore: 0.88,
      styleFromApi: false,
      hasChildren: false,
      hasParent: !!task.WhatId,
    })

    return {
      id: `sf:task:${task.Id}`,
      name,
      schema: EMCP_SCHEMA_VERSION,
      source: 'salesforce',
      sourceId: task.Id,
      type: 'BLOCK',
      role: task.IsClosed ? 'decorative' : task.Priority === 'High' ? 'primary' : 'tertiary',
      label: name,
      description: [
        `Status: ${task.Status}`,
        task.Priority ? `Priority: ${task.Priority}` : null,
        task.ActivityDate ? `Due: ${task.ActivityDate}` : null,
      ].filter(Boolean).join(' · ') || undefined,
      parentId: task.WhatId ? `sf:record:${task.WhatId}` : undefined,
      children: [],
      depth: task.WhatId ? 1 : 0,
      confidence,
      createdAt: task.CreatedDate,
      updatedAt: task.LastModifiedDate,
      raw: task as unknown as Record<string, unknown>,
    }
  }
}
