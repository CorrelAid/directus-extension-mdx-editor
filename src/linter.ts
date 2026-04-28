import { linter, type Diagnostic } from '@codemirror/lint'
import { compile } from '@mdx-js/mdx'
import type { EditorView } from '@codemirror/view'
import type { ComponentEntry, FrontmatterField, Manifest } from './autocomplete'

// ---------------------------------------------------------------------------
// Pure functions (exported for unit testing)
// ---------------------------------------------------------------------------

export interface CompileError {
  line?: number
  col?: number
  message: string
}

export interface ComponentUsage {
  name: string
  /** 1-based line number within the supplied content string */
  line: number
  /** 0-based column of the start of the component name */
  col: number
}

export interface PropError {
  componentName: string
  propName: string
  message: string
  severity: 'warning' | 'error'
  /** 1-based line number */
  line: number
  /** 0-based column of the opening < */
  col: number
}

/**
 * Strip a YAML frontmatter block from the top of the file.
 * Returns the remaining content and how many lines were removed so that
 * error positions can be shifted back into the original document.
 */
export function stripFrontmatter(content: string): { content: string; lineOffset: number } {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { content, lineOffset: 0 }
  }
  const end = content.indexOf('\n---', 4)
  if (end === -1) return { content, lineOffset: 0 }
  const closingEnd = content.indexOf('\n', end + 4) + 1
  const cutPoint = closingEnd > 0 ? closingEnd : end + 4
  const stripped = content.slice(cutPoint)
  const removed = content.slice(0, cutPoint)
  const lineOffset = removed.split('\n').length - (removed.endsWith('\n') ? 1 : 0)
  return { content: stripped, lineOffset }
}

/**
 * Compile MDX content and return the first error, or null if valid.
 * Does not include any remark/rehype plugins — call with frontmatter already stripped.
 */
export async function compileMdxContent(content: string): Promise<CompileError | null> {
  try {
    await compile(content, { development: false })
    return null
  } catch (err: any) {
    const start =
      err.position?.start ??
      (typeof err.place?.start === 'object' ? err.place.start : err.place) ??
      null
    return {
      line: start?.line ?? err.line,
      col: start?.column ?? err.column,
      message: err.reason ?? err.message ?? String(err),
    }
  }
}

/**
 * Scan content for JSX opening/self-closing tags whose names start with an
 * uppercase letter and are not in the known set.
 *
 * Skips lines inside fenced code blocks (```) and indented code blocks.
 * Only flags opening tags, not closing tags — one diagnostic per occurrence.
 *
 * Returns an empty array when `known` is empty (no manifest loaded).
 */
export function findUnknownComponents(content: string, known: Set<string>): ComponentUsage[] {
  if (known.size === 0) return []

  const results: ComponentUsage[] = []
  const lines = content.split('\n')
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (line.startsWith('    ') || line.startsWith('\t')) continue

    const tagRegex = /<([A-Z][A-Za-z0-9.]*)/g
    let match: RegExpExecArray | null
    while ((match = tagRegex.exec(line)) !== null) {
      const name = match[1]!
      if (known.has(name)) continue
      results.push({ name, line: i + 1, col: match.index + 1 }) // col points at <
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// HTML element validation
// ---------------------------------------------------------------------------

const KNOWN_HTML_ELEMENTS = new Set([
  // Document structure
  'html','head','body',
  // Metadata
  'title','base','link','meta','style',
  // Sections
  'address','article','aside','footer','header','h1','h2','h3','h4','h5','h6',
  'hgroup','main','nav','section','search',
  // Content grouping
  'blockquote','dd','div','dl','dt','figcaption','figure','hr','li','menu',
  'ol','p','pre','ul',
  // Inline text
  'a','abbr','b','bdi','bdo','br','cite','code','data','dfn','em','i','kbd',
  'mark','q','rp','rt','ruby','s','samp','small','span','strong','sub','sup',
  'time','u','var','wbr',
  // Media & embedded
  'area','audio','img','map','track','video','canvas','embed','fencedframe',
  'iframe','object','picture','portal','source','svg','math',
  // Scripting
  'noscript','script','del','ins',
  // Table
  'caption','col','colgroup','table','tbody','td','tfoot','th','thead','tr',
  // Forms
  'button','datalist','fieldset','form','input','label','legend','meter',
  'optgroup','option','output','progress','select','textarea',
  // Interactive
  'details','dialog','summary',
  // Web components
  'slot','template',
  // Common SVG children (used inline in MDX)
  'circle','clippath','defs','desc','ellipse','feblend','fecolormatrix',
  'fecomponenttransfer','fecomposite','feconvolvematrix','fediffuselighting',
  'fedisplacementmap','fedistantlight','fedropshadow','feflood','fefunca',
  'fefuncb','fefuncg','fefuncr','fegaussianblur','feimage','femerge',
  'femergenode','femorphology','feoffset','fepointlight','fespecularlighting',
  'fespotlight','fetile','feturbulence','filter','foreignobject','g','image',
  'line','lineargradient','marker','mask','metadata','mpath','path','pattern',
  'polygon','polyline','radialgradient','rect','stop','switch','symbol','text',
  'textpath','tspan','use','view',
])

export interface HtmlElementError {
  name: string
  line: number
  col: number
}

/**
 * Scan content for opening HTML element tags whose names are not recognised
 * HTML elements (and are not hyphenated custom elements or SVG elements).
 * Only flags opening tags; closing tags are skipped.
 */
export function findUnknownHtmlElements(content: string): HtmlElementError[] {
  const results: HtmlElementError[] = []
  const lines = content.split('\n')
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (/^(`{3,}|~{3,})/.test(line.trim())) { inFence = !inFence; continue }
    if (inFence) continue
    if (line.startsWith('    ') || line.startsWith('\t')) continue

    const tagRegex = /<([a-z][a-zA-Z0-9]*)/g
    let match: RegExpExecArray | null
    while ((match = tagRegex.exec(line)) !== null) {
      const name = match[1]!
      if (KNOWN_HTML_ELEMENTS.has(name)) continue
      // Hyphenated names are valid custom elements — skip them.
      if (name.includes('-')) continue
      results.push({ name, line: i + 1, col: match.index })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Prop validation helpers
// ---------------------------------------------------------------------------

/**
 * Find the closing '>' of a JSX tag starting at `start` (which points to '<').
 * Tracks string literals and curly-brace depth so '>' inside expressions is skipped.
 * Returns the index of '>' or -1 if not found.
 */
function findTagEnd(content: string, start: number): number {
  let i = start + 1
  let depth = 0
  let inStr: '"' | "'" | null = null
  while (i < content.length) {
    const ch = content[i]!
    if (inStr) {
      if (ch === inStr && content[i - 1] !== '\\') inStr = null
    } else if (ch === '"') {
      inStr = '"'
    } else if (ch === "'") {
      inStr = "'"
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
    } else if (ch === '>' && depth === 0) {
      return i
    }
    i++
  }
  return -1
}

/**
 * Parse prop name→value pairs from the inner content of a JSX tag
 * (the text between '<' and '>', exclusive).
 * Values are the raw string for quoted props, null for expressions/booleans.
 */
function parseTagProps(inner: string): Map<string, string | null> {
  const result = new Map<string, string | null>()
  let i = 0
  // Skip component name
  while (i < inner.length && /[A-Za-z0-9.]/.test(inner[i]!)) i++

  while (i < inner.length) {
    // Skip whitespace
    while (i < inner.length && /\s/.test(inner[i]!)) i++
    // Self-closing slash or end
    if (i >= inner.length || inner[i] === '/') break
    // Prop name must start with a letter
    if (!/[a-zA-Z]/.test(inner[i]!)) { i++; continue }

    const nameStart = i
    while (i < inner.length && /[a-zA-Z0-9_-]/.test(inner[i]!)) i++
    const propName = inner.slice(nameStart, i)

    // Skip whitespace before possible '='
    while (i < inner.length && inner[i] === ' ') i++

    if (inner[i] !== '=') {
      result.set(propName, null) // boolean prop
      continue
    }
    i++ // skip '='

    // Skip whitespace after '='
    while (i < inner.length && inner[i] === ' ') i++

    if (inner[i] === '"') {
      i++
      let val = ''
      while (i < inner.length && inner[i] !== '"') val += inner[i++]
      i++ // closing "
      result.set(propName, val)
    } else if (inner[i] === "'") {
      i++
      let val = ''
      while (i < inner.length && inner[i] !== "'") val += inner[i++]
      i++ // closing '
      result.set(propName, val)
    } else if (inner[i] === '{') {
      // Expression — skip balanced braces
      let depth = 0
      while (i < inner.length) {
        if (inner[i] === '{') depth++
        else if (inner[i] === '}') { depth--; if (depth === 0) { i++; break } }
        i++
      }
      result.set(propName, null) // can't validate dynamic values
    }
  }
  return result
}

/** Extract string literal variants from a union type string, e.g. '"info" | "warning"' → ['info', 'warning'] */
function parseEnumType(type: string): string[] | null {
  const matches = [...type.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
  return matches.length > 0 ? matches : null
}

/** Build a sorted array of character positions where each line starts (lineStarts[0] === 0). */
function buildLineStarts(content: string): number[] {
  const starts = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1)
  }
  return starts
}

function posToLineCol(lineStarts: number[], pos: number): { line: number; col: number } {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid]! <= pos) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, col: pos - lineStarts[lo]! }
}

/** Return [start, end] character ranges of fenced code blocks. */
function getFencedRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let fenceStart = -1
  let fenceChar = ''
  for (const m of content.matchAll(/^(`{3,}|~{3,})/gm)) {
    const char = m[1]![0]!
    if (fenceStart === -1) {
      fenceStart = m.index!
      fenceChar = char
    } else if (char === fenceChar) {
      const lineEnd = content.indexOf('\n', m.index!)
      ranges.push([fenceStart, lineEnd === -1 ? content.length : lineEnd])
      fenceStart = -1
    }
  }
  return ranges
}

/**
 * Validate props on known JSX components against the manifest.
 * Reports: unknown prop names, missing required props, invalid enum values.
 *
 * Skips fenced code blocks and indented code blocks.
 * Returns an empty array when `manifest` is empty.
 */
export function findInvalidProps(content: string, manifest: ComponentEntry[]): PropError[] {
  if (manifest.length === 0) return []

  const componentMap = new Map(manifest.map((c) => [c.name, c]))
  const results: PropError[] = []
  const lineStarts = buildLineStarts(content)
  const fenced = getFencedRanges(content)
  const inFence = (pos: number) => fenced.some(([a, b]) => pos >= a && pos <= b)

  const TAG_RE = /<([A-Z][A-Za-z0-9.]*)/g
  let m: RegExpExecArray | null

  while ((m = TAG_RE.exec(content)) !== null) {
    const tagPos = m.index
    if (inFence(tagPos)) continue

    // Skip indented code blocks — check whether this line starts with 4 spaces or tab
    const { line: lineNum, col } = posToLineCol(lineStarts, tagPos)
    const lineStart = lineStarts[lineNum - 1]!
    const lineText = content.slice(lineStart, content.indexOf('\n', lineStart) + 1 || undefined)
    if (lineText.startsWith('    ') || lineText.startsWith('\t')) continue

    const componentName = m[1]!
    const component = componentMap.get(componentName)
    if (!component) continue // unknown components handled by findUnknownComponents

    const tagEnd = findTagEnd(content, tagPos)
    if (tagEnd === -1) continue
    const inner = content.slice(tagPos + 1, tagEnd)
    const usedProps = parseTagProps(inner)

    const knownPropNames = new Set(component.props.map((p) => p.name))
    const validPropList = component.props.map((p) => p.name).join(', ') || 'none'

    // Unknown props — advisory only; manifest may be incomplete
    for (const [propName] of usedProps) {
      if (!knownPropNames.has(propName)) {
        results.push({
          componentName,
          propName,
          severity: 'warning',
          message: `Unknown prop "${propName}" on <${componentName}>. Valid props: ${validPropList}.`,
          line: lineNum,
          col,
        })
      }
    }

    // Missing required props — blocks save
    for (const prop of component.props) {
      if (prop.required && !usedProps.has(prop.name)) {
        const requiredList = component.props.filter((p) => p.required).map((p) => p.name).join(', ')
        results.push({
          componentName,
          propName: prop.name,
          severity: 'error',
          message: `Required prop "${prop.name}" is missing on <${componentName}>. Required: ${requiredList}.`,
          line: lineNum,
          col,
        })
      }
    }

    // Invalid enum values — blocks save
    for (const prop of component.props) {
      const value = usedProps.get(prop.name)
      if (typeof value !== 'string') continue
      const allowed = parseEnumType(prop.type)
      if (!allowed) continue
      if (!allowed.includes(value)) {
        results.push({
          componentName,
          propName: prop.name,
          severity: 'error',
          message: `Invalid value "${value}" for prop "${prop.name}" on <${componentName}>. Expected one of: ${allowed.map((v) => `"${v}"`).join(' | ')}.`,
          line: lineNum,
          col,
        })
      }
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Frontmatter validation
// ---------------------------------------------------------------------------

export interface FrontmatterError {
  field: string
  message: string
  severity: 'warning' | 'error'
  /** 1-based absolute line number in the full document */
  line: number
  /** 0-based start column */
  col: number
  /** number of characters to underline */
  length: number
}

/** Parse top-level scalar YAML keys from the content between the two `---` lines. */
function parseFrontmatterKeys(
  yaml: string,
  lineBase: number,
): Map<string, { raw: string; line: number; col: number }> {
  const result = new Map<string, { raw: string; line: number; col: number }>()
  for (const [i, line] of yaml.split('\n').entries()) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/)
    if (!m) continue
    result.set(m[1]!, { raw: m[2]!.trim(), line: lineBase + i, col: 0 })
  }
  return result
}

/**
 * Validate YAML frontmatter field names, required presence, and enum values
 * against the manifest's frontmatter field definitions.
 * Returns an empty array when `fields` is empty.
 */
export function findInvalidFrontmatter(raw: string, fields: FrontmatterField[]): FrontmatterError[] {
  if (fields.length === 0) return []
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return []
  const end = raw.indexOf('\n---', 4)
  if (end === -1) return []

  const yaml = raw.slice(4, end)
  const parsed = parseFrontmatterKeys(yaml, 2) // line 1 is the opening ---
  const results: FrontmatterError[] = []
  const knownFields = new Set(fields.map((f) => f.name))

  const validFieldList = [...knownFields].join(', ')

  // Unknown fields — advisory only; manifest may be incomplete
  for (const [key, { line }] of parsed) {
    if (!knownFields.has(key)) {
      results.push({
        field: key,
        severity: 'warning' as const,
        message: `Unknown frontmatter field "${key}". Valid fields: ${validFieldList}.`,
        line,
        col: 0,
        length: key.length,
      })
    }
  }

  // Missing required fields — blocks save; point at the opening ---
  for (const field of fields) {
    if (field.required && !parsed.has(field.name)) {
      results.push({
        field: field.name,
        severity: 'error' as const,
        message: `Required frontmatter field "${field.name}" is missing.`,
        line: 1,
        col: 0,
        length: 3,
      })
    }
  }

  // Invalid enum values — blocks save
  for (const field of fields) {
    const entry = parsed.get(field.name)
    if (!entry?.raw) continue
    const allowed = parseEnumType(field.type)
    if (!allowed) continue
    if (!allowed.includes(entry.raw)) {
      results.push({
        field: field.name,
        severity: 'error' as const,
        message: `Invalid value "${entry.raw}" for frontmatter field "${field.name}". Expected one of: ${allowed.map((v) => `"${v}"`).join(' | ')}.`,
        line: entry.line,
        col: field.name.length + 2, // skip "key: "
        length: entry.raw.length,
      })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// CodeMirror linter (wraps the pure functions above)
// ---------------------------------------------------------------------------

/**
 * @param manifest - Full manifest (components + frontmatter fields). When
 *   empty, unknown-component warnings and prop/frontmatter validation are suppressed.
 * @param onDiagnostics - Called after each linter run with whether there are
 *   any error-severity diagnostics. Used by the interface to gate saves.
 */
export function mdxLinter(
  manifest: Manifest = { components: [], frontmatter: [] },
  onDiagnostics?: (hasSyntaxErrors: boolean) => void,
) {
  const knownComponents = new Set(manifest.components.map((c) => c.name))

  return linter(
    async (view: EditorView) => {
      const raw = view.state.doc.toString()
      if (!raw.trim()) {
        onDiagnostics?.(false)
        return []
      }

      const { content, lineOffset } = stripFrontmatter(raw)
      const diagnostics: Diagnostic[] = []

      // Pass 0 — frontmatter field validation
      for (const err of findInvalidFrontmatter(raw, manifest.frontmatter)) {
        const lineCount = view.state.doc.lines
        const docLine = view.state.doc.line(Math.min(err.line, lineCount))
        const from = Math.min(docLine.from + err.col, docLine.to)
        const to = Math.min(from + err.length, docLine.to)
        diagnostics.push({ from, to, severity: err.severity, message: err.message })
      }

      // Pass 1 — MDX syntax errors via @mdx-js/mdx
      if (content.trim()) {
        const err = await compileMdxContent(content)
        if (err) {
          diagnostics.push(compileErrorToDiagnostic(view, err, lineOffset))
        }
      }

      // Pass 2 — unknown component names (only when a manifest is loaded)
      for (const usage of findUnknownComponents(content, knownComponents)) {
        const adjustedLine = usage.line + lineOffset
        const lineCount = view.state.doc.lines
        const docLine = view.state.doc.line(Math.min(adjustedLine, lineCount))
        const from = Math.min(docLine.from + usage.col, docLine.to)
        const to = Math.min(from + usage.name.length + 1, docLine.to)
        diagnostics.push({
          from,
          to,
          severity: 'error',
          message: `Unknown component "${usage.name}" — not found in the component manifest.`,
        })
      }

      // Pass 3 — prop validation against the manifest
      for (const err of findInvalidProps(content, manifest.components)) {
        const adjustedLine = err.line + lineOffset
        const lineCount = view.state.doc.lines
        const docLine = view.state.doc.line(Math.min(adjustedLine, lineCount))
        const from = Math.min(docLine.from + err.col, docLine.to)
        const to = Math.min(from + err.componentName.length + 1, docLine.to)
        // Unknown props are advisory (manifest may be incomplete) → warning only.
        // Missing required props and invalid enum values block save → error.
        diagnostics.push({
          from,
          to,
          severity: err.severity,
          message: err.message,
        })
      }

      // Pass 4 — unknown HTML element names (warning; custom elements with hyphens are skipped)
      for (const err of findUnknownHtmlElements(content)) {
        const adjustedLine = err.line + lineOffset
        const lineCount = view.state.doc.lines
        const docLine = view.state.doc.line(Math.min(adjustedLine, lineCount))
        const from = Math.min(docLine.from + err.col, docLine.to)
        const to = Math.min(from + err.name.length + 1, docLine.to)
        diagnostics.push({
          from,
          to,
          severity: 'warning',
          message: `Unknown HTML element "<${err.name}>" — possible typo?`,
        })
      }

      onDiagnostics?.(diagnostics.some((d) => d.severity === 'error'))
      return diagnostics
    },
    { delay: 750 },
  )
}

function compileErrorToDiagnostic(view: EditorView, err: CompileError, lineOffset: number): Diagnostic {
  if (!err.line) return { from: 0, to: 0, severity: 'error', message: err.message }
  const lineCount = view.state.doc.lines
  const docLine = view.state.doc.line(Math.min(err.line + lineOffset, lineCount))
  const col = Math.max(0, (err.col ?? 1) - 1)
  const from = Math.min(docLine.from + col, docLine.to)
  const to = Math.min(from + 1, docLine.to)
  return { from, to, severity: 'error', message: err.message }
}
