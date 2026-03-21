import { describe, it, expect } from 'vitest'
import { SemanticTagger } from '../../src/enrichment/tagger'

describe('SemanticTagger', () => {
  const tagger = new SemanticTagger()

  it('identifies buttons by name', () => {
    const result = tagger.tag('Submit Button')
    expect(result.type).toBe('BUTTON')
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('identifies frames from source type', () => {
    const result = tagger.tag('Dashboard', 'FRAME')
    expect(result.type).toBe('FRAME')
    expect(result.confidence).toBeGreaterThan(0.9)
  })

  it('identifies primary role', () => {
    const result = tagger.tag('Primary CTA Button')
    expect(result.role).toBe('primary')
  })

  it('identifies secondary role', () => {
    const result = tagger.tag('Cancel Button')
    expect(result.role).toBe('secondary')
  })

  it('returns UNKNOWN for unrecognized names', () => {
    const result = tagger.tag('xyzzy_abc_123')
    expect(result.type).toBe('UNKNOWN')
    expect(result.confidence).toBeLessThan(0.5)
  })

  it('identifies navbar', () => {
    const result = tagger.tag('Top Navigation Bar')
    expect(result.type).toBe('NAVBAR')
  })

  it('identifies text nodes', () => {
    const result = tagger.tag('Heading Title', 'TEXT')
    expect(result.type).toBe('TEXT')
  })

  it('identifies page from source type', () => {
    const result = tagger.tag('Home Screen', 'PAGE')
    expect(result.type).toBe('PAGE')
  })

  it('handles kebab-case names', () => {
    const result = tagger.tag('primary-submit-btn')
    expect(result.type).toBe('BUTTON')
  })

  it('handles snake_case names', () => {
    const result = tagger.tag('sidebar_nav_panel')
    expect(result.type).toBe('SIDEBAR')
  })
})
