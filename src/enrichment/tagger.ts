import type { SemanticType, EnrichedNode } from '../core/types.js'

interface TagResult {
  type: SemanticType
  role: EnrichedNode['role']
  confidence: number
}

// ─── Keyword maps ──────────────────────────────────────────────────────────────

const TYPE_KEYWORDS: Array<{ type: SemanticType; keywords: string[] }> = [
  { type: 'BUTTON', keywords: ['button', 'btn', 'cta', 'submit', 'cancel', 'action', 'click'] },
  { type: 'INPUT', keywords: ['input', 'field', 'textfield', 'search', 'email', 'password', 'form-field'] },
  { type: 'NAVBAR', keywords: ['nav', 'navbar', 'navigation', 'header', 'topbar', 'menu-bar'] },
  { type: 'SIDEBAR', keywords: ['sidebar', 'side-panel', 'drawer', 'left-panel', 'right-panel'] },
  { type: 'MODAL', keywords: ['modal', 'dialog', 'overlay', 'popup', 'sheet', 'drawer'] },
  { type: 'CARD', keywords: ['card', 'tile', 'panel', 'item', 'thumbnail', 'preview'] },
  { type: 'TABLE', keywords: ['table', 'grid', 'data-grid', 'spreadsheet', 'list-view'] },
  { type: 'LIST', keywords: ['list', 'ul', 'ol', 'listitem', 'collection', 'feed'] },
  { type: 'IMAGE', keywords: ['image', 'img', 'photo', 'picture', 'avatar', 'thumbnail', 'banner', 'hero'] },
  { type: 'ICON', keywords: ['icon', 'ico', 'glyph', 'symbol', 'chevron', 'arrow-icon'] },
  { type: 'LINK', keywords: ['link', 'anchor', 'href', 'url', 'breadcrumb'] },
  { type: 'TEXT', keywords: ['text', 'label', 'title', 'heading', 'paragraph', 'caption', 'body', 'description', 'h1', 'h2', 'h3'] },
  { type: 'HEADING', keywords: ['heading', 'headline', 'h1', 'h2', 'h3', 'h4', 'title', 'subtitle'] },
  { type: 'SECTION', keywords: ['section', 'segment', 'area', 'zone', 'region', 'hero', 'footer', 'content'] },
  { type: 'PAGE', keywords: ['page', 'screen', 'view', 'route', 'document', 'canvas'] },
  { type: 'FRAME', keywords: ['frame', 'artboard', 'container', 'wrapper', 'layout'] },
  { type: 'COMPONENT', keywords: ['component', 'comp', 'element', 'widget'] },
  { type: 'DATABASE', keywords: ['database', 'db', 'collection', 'store', 'table-view'] },
  { type: 'ROW', keywords: ['row', 'record', 'entry', 'item-row', 'data-row'] },
  { type: 'CELL', keywords: ['cell', 'field', 'value', 'property'] },
  { type: 'BLOCK', keywords: ['block', 'chunk', 'node', 'content-block', 'callout', 'quote', 'toggle'] },
]

const ROLE_KEYWORDS: Array<{ role: EnrichedNode['role']; keywords: string[] }> = [
  { role: 'primary', keywords: ['primary', 'main', 'cta', 'submit', 'confirm', 'save', 'create'] },
  { role: 'secondary', keywords: ['secondary', 'cancel', 'back', 'dismiss', 'skip'] },
  { role: 'tertiary', keywords: ['tertiary', 'ghost', 'link', 'minimal', 'subtle'] },
  { role: 'decorative', keywords: ['decorative', 'illustration', 'background', 'divider', 'separator', 'spacer'] },
  { role: 'structural', keywords: ['frame', 'wrapper', 'container', 'layout', 'grid', 'group'] },
]

// ─── Tagger ────────────────────────────────────────────────────────────────────

export class SemanticTagger {
  /**
   * Classify a node based on its name and any Figma/source type hint.
   */
  tag(name: string, sourceType?: string): TagResult {
    const normalized = name.toLowerCase().replace(/[^a-z0-9\s-_]/g, '')
    const tokens = normalized.split(/[\s\-_/]+/)

    // 1. Check source type hint first (e.g. Figma's node type)
    const typeFromSource = this.mapSourceType(sourceType)
    if (typeFromSource) {
      return {
        type: typeFromSource,
        role: this.inferRole(tokens),
        confidence: 0.92,
      }
    }

    // 2. Score each semantic type by keyword match
    let bestType: SemanticType = 'UNKNOWN'
    let bestScore = 0

    for (const { type, keywords } of TYPE_KEYWORDS) {
      let score = 0
      for (const token of tokens) {
        for (const kw of keywords) {
          if (token === kw) { score += 2; break }
          if (token.includes(kw) || kw.includes(token)) { score += 1; break }
        }
      }
      if (score > bestScore) {
        bestScore = score
        bestType = type
      }
    }

    const confidence = bestScore === 0 ? 0.3 : Math.min(0.5 + bestScore * 0.15, 0.88)

    return {
      type: bestType,
      role: this.inferRole(tokens),
      confidence,
    }
  }

  private mapSourceType(sourceType?: string): SemanticType | null {
    if (!sourceType) return null
    const t = sourceType.toUpperCase()
    const map: Record<string, SemanticType> = {
      FRAME: 'FRAME',
      COMPONENT: 'COMPONENT',
      COMPONENT_SET: 'COMPONENT',
      INSTANCE: 'INSTANCE',
      GROUP: 'GROUP',
      TEXT: 'TEXT',
      RECTANGLE: 'CONTAINER',
      ELLIPSE: 'CONTAINER',
      VECTOR: 'ICON',
      BOOLEAN_OPERATION: 'ICON',
      PARAGRAPH: 'PARAGRAPH',
      PAGE: 'PAGE',
    }
    return map[t] ?? null
  }

  private inferRole(tokens: string[]): EnrichedNode['role'] {
    for (const { role, keywords } of ROLE_KEYWORDS) {
      for (const token of tokens) {
        if (keywords.some((kw) => token === kw || token.includes(kw))) {
          return role
        }
      }
    }
    return 'unknown'
  }
}
