import type { CompletionContext, CompletionSource, Completion } from '@codemirror/autocomplete'

export interface PropEntry {
  name: string
  type: string
  description?: string
  required?: boolean
}

export interface ComponentEntry {
  name: string
  description?: string
  props: PropEntry[]
}

export interface FrontmatterField {
  name: string
  /** 'string' | 'boolean' | 'number' | 'string[]' | '"val1" | "val2"' (enum) */
  type: string
  required?: boolean
  description?: string
}

export interface Manifest {
  components: ComponentEntry[]
  frontmatter: FrontmatterField[]
}

/**
 * Normalise the raw JSON value from the manifest URL into a Manifest object.
 * Accepts both the legacy array format (components only) and the new object format.
 */
export function parseManifest(raw: unknown): Manifest {
  if (Array.isArray(raw)) {
    return { components: raw as ComponentEntry[], frontmatter: [] }
  }
  const obj = raw as Record<string, unknown>
  return {
    components: Array.isArray(obj.components) ? (obj.components as ComponentEntry[]) : [],
    frontmatter: Array.isArray(obj.frontmatter) ? (obj.frontmatter as FrontmatterField[]) : [],
  }
}

// Walk backwards from pos to find the nearest unclosed opening tag and return its component name.
// Returns null if we're not inside a JSX/MDX tag.
function getOpenTagName(text: string, pos: number): string | null {
  const slice = text.slice(0, pos)
  const lastOpen = slice.lastIndexOf('<')
  if (lastOpen === -1) return null
  const between = slice.slice(lastOpen + 1)
  // If there's a closing > between < and cursor, we're outside a tag
  if (between.includes('>')) return null
  const match = between.match(/^([A-Z][A-Za-z0-9.]*)/)
  return match ? match[1] : null
}

// True when the character immediately before pos is '<'
function isTagOpenTrigger(text: string, pos: number): boolean {
  return pos > 0 && text[pos - 1] === '<'
}

// If the cursor is inside a prop value position (propName="|), return component + prop name.
function getPropValueContext(text: string, pos: number): { component: string; prop: string } | null {
  const slice = text.slice(0, pos)
  const match = slice.match(/<([A-Z][A-Za-z0-9.]*)[^>]*?\s([a-zA-Z][a-zA-Z0-9]*)\s*=\s*"$/)
  return match ? { component: match[1], prop: match[2] } : null
}

// Extract string literal variants from a union type string, e.g. '"prose" | "max"' → ['prose', 'max']
function extractLiterals(type: string): string[] {
  const matches = type.match(/"([^"]+)"/g)
  return matches ? matches.map((m) => m.replace(/"/g, '')) : []
}

export function buildCompletionSource(manifest: Manifest): CompletionSource {
  const componentMap = new Map(manifest.components.map((c) => [c.name, c]))

  return (context: CompletionContext) => {
    const text = context.state.doc.toString()
    const pos = context.pos

    // (a) After '<' — complete component names
    if (isTagOpenTrigger(text, pos)) {
      const options: Completion[] = manifest.components.map((c) => ({
        label: c.name,
        type: 'keyword',
        detail: c.description,
        apply: c.props.length > 0 ? `${c.name} ` : c.name,
      }))
      return { from: pos, options, validFor: /^[A-Z][A-Za-z0-9.]*$/ }
    }

    // (c) Inside a prop value: propName="|  — complete enum literals
    const propValueCtx = getPropValueContext(text, pos)
    if (propValueCtx) {
      const comp = componentMap.get(propValueCtx.component)
      const prop = comp?.props.find((p) => p.name === propValueCtx.prop)
      if (prop) {
        const literals = extractLiterals(prop.type)
        if (literals.length > 0) {
          return {
            from: pos,
            options: literals.map((v) => ({ label: v, type: 'constant' })),
          }
        }
      }
      return null
    }

    // (b) Inside an open tag — complete prop names
    const tagName = getOpenTagName(text, pos)
    if (tagName) {
      const comp = componentMap.get(tagName)
      if (!comp || comp.props.length === 0) return null

      const word = context.matchBefore(/[a-zA-Z]*/)
      const options: Completion[] = comp.props.map((p) => ({
        label: p.name,
        type: 'property',
        detail: `${p.type}${p.required ? ' · required' : ''}`,
        info: p.description,
        apply: (view, completion, from, to) => {
          view.dispatch({
            changes: { from, to, insert: `${completion.label}=""` },
            selection: { anchor: from + completion.label.length + 2 },
          })
        },
      }))
      return { from: word?.from ?? pos, options, validFor: /^[a-zA-Z]*$/ }
    }

    return null
  }
}
