import type { Confidence, Spatial } from '../core/types.js'

export interface ConfidenceInputs {
  spatialFromApi: boolean      // true = coordinates came directly from API
  semanticScore: number        // from tagger (0–1)
  styleFromApi: boolean        // true = style tokens from API
  hasChildren: boolean
  hasParent: boolean
}

/**
 * Scores confidence per field category.
 * 0.99 = exact from API source
 * 0.70–0.90 = strongly inferred
 * 0.40–0.69 = weakly inferred
 * 0.10–0.39 = guessed / fallback
 */
export class ConfidenceScorer {
  score(inputs: ConfidenceInputs): Confidence {
    const spatial = inputs.spatialFromApi ? 0.99 : 0.35
    const semantic = inputs.semanticScore
    const style = inputs.styleFromApi ? 0.97 : 0.4
    const overall = (spatial + semantic + style) / 3

    return {
      spatial: round(spatial),
      semantic: round(semantic),
      style: round(style),
      overall: round(overall),
    }
  }

  /**
   * Compute spatial confidence from available data.
   * If all four coords present from API → 0.99.
   * If partially available → proportional.
   */
  scoreSpatial(spatial: Partial<Spatial> | undefined, fromApi: boolean): number {
    if (!spatial) return 0.1
    if (fromApi) return 0.99

    const fields: (keyof Spatial)[] = ['x', 'y', 'width', 'height']
    const present = fields.filter((f) => spatial[f] !== undefined).length
    return round(0.2 + (present / fields.length) * 0.6)
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
