import { describe, it, expect } from 'vitest'
import { SalesforceAdapter } from '../../src/adapters/salesforce'

const mockOpportunity = {
  Id: 'opp001',
  attributes: { type: 'Opportunity', url: '/services/data/v58.0/sobjects/Opportunity/opp001' },
  Name: 'Acme Corp — Enterprise Deal',
  StageName: 'Proposal/Price Quote',
  Amount: 250000,
  CloseDate: '2026-06-30',
  Probability: 65,
  IsClosed: false,
  IsWon: false,
  AccountId: 'acc001',
  Account: { Id: 'acc001', Name: 'Acme Corp' },
  Owner: { Id: 'usr001', Name: 'Alice Chen' },
  CreatedDate: '2026-01-15T10:00:00Z',
  LastModifiedDate: '2026-03-20T09:00:00Z',
}

const mockWonOpportunity = {
  Id: 'opp002',
  attributes: { type: 'Opportunity' },
  Name: 'Globex Deal',
  StageName: 'Closed Won',
  Amount: 80000,
  CloseDate: '2026-02-28',
  Probability: 100,
  IsClosed: true,
  IsWon: true,
  CreatedDate: '2026-01-01T00:00:00Z',
  LastModifiedDate: '2026-02-28T00:00:00Z',
}

const mockContact = {
  Id: 'con001',
  attributes: { type: 'Contact' },
  FirstName: 'John',
  LastName: 'Smith',
  Email: 'john.smith@acme.com',
  Phone: '+1-555-0100',
  Title: 'VP of Engineering',
  Department: 'Engineering',
  AccountId: 'acc001',
  Account: { Id: 'acc001', Name: 'Acme Corp' },
  CreatedDate: '2026-01-10T00:00:00Z',
  LastModifiedDate: '2026-03-01T00:00:00Z',
}

const mockAccount = {
  Id: 'acc001',
  attributes: { type: 'Account' },
  Name: 'Acme Corp',
  Industry: 'Technology',
  Type: 'Customer',
  AnnualRevenue: 50000000,
  NumberOfEmployees: 500,
  Website: 'https://acme.com',
  Rating: 'Hot',
  CreatedDate: '2025-06-01T00:00:00Z',
  LastModifiedDate: '2026-03-15T00:00:00Z',
}

const mockCase = {
  Id: 'case001',
  attributes: { type: 'Case' },
  CaseNumber: '00001234',
  Subject: 'Login failure on mobile app',
  Status: 'In Progress',
  Priority: 'High',
  IsEscalated: true,
  IsClosed: false,
  AccountId: 'acc001',
  Account: { Id: 'acc001', Name: 'Acme Corp' },
  CreatedDate: '2026-03-20T08:00:00Z',
  LastModifiedDate: '2026-03-21T10:00:00Z',
}

const mockLead = {
  Id: 'lead001',
  attributes: { type: 'Lead' },
  FirstName: 'Jane',
  LastName: 'Doe',
  Email: 'jane.doe@startup.io',
  Company: 'StartupIO',
  Title: 'CTO',
  Status: 'Working - Contacted',
  Rating: 'Hot',
  IsConverted: false,
  LeadSource: 'Web',
  CreatedDate: '2026-03-18T00:00:00Z',
  LastModifiedDate: '2026-03-21T00:00:00Z',
}

const mockQueryResult = {
  totalSize: 2,
  done: true,
  records: [mockOpportunity, mockWonOpportunity],
}

describe('SalesforceAdapter', () => {
  const adapter = new SalesforceAdapter()

  it('has correct name', () => {
    expect(adapter.name).toBe('salesforce')
  })

  it('canHandle salesforce tool names', () => {
    expect(adapter.canHandle('salesforce_get_record', {})).toBe(true)
    expect(adapter.canHandle('sf_query', {})).toBe(true)
    expect(adapter.canHandle('soql_query', {})).toBe(true)
    expect(adapter.canHandle('get_opportunity', {})).toBe(true)
    expect(adapter.canHandle('get_account', {})).toBe(true)
    expect(adapter.canHandle('figma_get_file', {})).toBe(false)
  })

  it('parses an opportunity', async () => {
    const nodes = await adapter.parse('get_opportunity', mockOpportunity)
    expect(nodes.length).toBe(1)
    const opp = nodes[0]
    expect(opp.id).toBe('sf:opportunity:opp001')
    expect(opp.name).toBe('Acme Corp — Enterprise Deal')
    expect(opp.source).toBe('salesforce')
    expect(opp.schema).toBe('emcp/v1')
  })

  it('marks high-probability open opp as primary role', async () => {
    const highProb = { ...mockOpportunity, Probability: 80 }
    const nodes = await adapter.parse('get_opportunity', highProb)
    expect(nodes[0].role).toBe('primary')
  })

  it('marks won opportunity as decorative', async () => {
    const nodes = await adapter.parse('get_opportunity', mockWonOpportunity)
    expect(nodes[0].role).toBe('decorative')
  })

  it('formats currency in description', async () => {
    const nodes = await adapter.parse('get_opportunity', mockOpportunity)
    expect(nodes[0].description).toContain('$250,000')
  })

  it('sets parentId from AccountId on opportunity', async () => {
    const nodes = await adapter.parse('get_opportunity', mockOpportunity)
    expect(nodes[0].parentId).toBe('sf:account:acc001')
  })

  it('parses a contact', async () => {
    const nodes = await adapter.parse('get_contact', mockContact)
    expect(nodes.length).toBe(1)
    const contact = nodes[0]
    expect(contact.id).toBe('sf:contact:con001')
    expect(contact.name).toBe('John Smith')
    expect(contact.description).toContain('VP of Engineering')
    expect(contact.description).toContain('john.smith@acme.com')
  })

  it('parses an account', async () => {
    const nodes = await adapter.parse('get_account', mockAccount)
    expect(nodes.length).toBe(1)
    const acc = nodes[0]
    expect(acc.id).toBe('sf:account:acc001')
    expect(acc.type).toBe('CONTAINER')
    expect(acc.description).toContain('Technology')
    expect(acc.description).toContain('500')
  })

  it('parses a case', async () => {
    const nodes = await adapter.parse('get_case', mockCase)
    expect(nodes.length).toBe(1)
    const c = nodes[0]
    expect(c.id).toBe('sf:case:case001')
    expect(c.role).toBe('primary') // escalated
    expect(c.description).toContain('ESCALATED')
    expect(c.description).toContain('#00001234')
  })

  it('parses a lead', async () => {
    const nodes = await adapter.parse('get_lead', mockLead)
    expect(nodes.length).toBe(1)
    const lead = nodes[0]
    expect(lead.id).toBe('sf:lead:lead001')
    expect(lead.name).toBe('Jane Doe')
    expect(lead.role).toBe('primary') // Hot rating
  })

  it('parses SOQL query result', async () => {
    const nodes = await adapter.parse('soql_query', mockQueryResult)
    expect(nodes.length).toBe(2)
  })

  it('auto-detects record type without attributes', async () => {
    const noAttrs = { ...mockOpportunity }
    delete (noAttrs as Record<string, unknown>)['attributes']
    const nodes = await adapter.parse('get_record', noAttrs)
    expect(nodes.length).toBe(1)
    expect(nodes[0].id).toContain('sf:opportunity:')
  })

  it('returns empty array for unrecognized input', async () => {
    const nodes = await adapter.parse('get_record', { random: 'garbage' })
    expect(nodes).toEqual([])
  })

  it('stores enriched raw metadata', async () => {
    const nodes = await adapter.parse('get_opportunity', mockOpportunity)
    const raw = nodes[0].raw as Record<string, unknown>
    expect(raw['_isWon']).toBe(false)
    expect(raw['_stage']).toBe('Proposal/Price Quote')
    expect(raw['_accountName']).toBe('Acme Corp')
    expect(raw['_amount']).toBe(250000)
  })
})
