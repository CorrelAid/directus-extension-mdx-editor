import { describe, it, expect } from 'vitest'
import {
  stripFrontmatter,
  compileMdxContent,
  findUnknownComponents,
  findInvalidProps,
  findInvalidFrontmatter,
} from '../linter'
import type { ComponentEntry, FrontmatterField } from '../autocomplete'

// ---------------------------------------------------------------------------
// stripFrontmatter
// ---------------------------------------------------------------------------

describe('stripFrontmatter', () => {
  it('strips frontmatter and reports correct line offset', () => {
    const input = '---\ntitle: Hello\ndate: 2024-01-01\n---\n\n# Body'
    const { content, lineOffset } = stripFrontmatter(input)
    expect(content).toBe('\n# Body')
    expect(lineOffset).toBe(4)
  })

  it('leaves content without frontmatter unchanged', () => {
    const input = '# No frontmatter\n\nContent'
    const { content, lineOffset } = stripFrontmatter(input)
    expect(content).toBe(input)
    expect(lineOffset).toBe(0)
  })

  it('handles a document that is only frontmatter', () => {
    const input = '---\ntitle: Only FM\n---'
    const { content, lineOffset } = stripFrontmatter(input)
    expect(content).toBe('')
    expect(lineOffset).toBe(3)
  })

  it('does not strip when opening --- is not on its own line', () => {
    const input = '---title: inline\n---\n\n# Body'
    const { lineOffset } = stripFrontmatter(input)
    expect(lineOffset).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// compileMdxContent
// ---------------------------------------------------------------------------

describe('compileMdxContent', () => {
  it('returns null for valid MDX', async () => {
    const result = await compileMdxContent('# Hello\n\nSome **bold** text.')
    expect(result).toBeNull()
  })

  it('returns null for self-closing JSX components', async () => {
    const result = await compileMdxContent('# Hello\n\n<InfoBox title="Hi" />')
    expect(result).toBeNull()
  })

  it('returns null for JSX components with children', async () => {
    const result = await compileMdxContent('<InfoBox>\n\nContent\n\n</InfoBox>')
    expect(result).toBeNull()
  })

  it('returns an error for an unclosed JSX tag', async () => {
    const result = await compileMdxContent('# Hello\n\n<InfoBox')
    expect(result).not.toBeNull()
    expect(result?.message).toBeTruthy()
  })

  it('returns an error for mismatched JSX tags', async () => {
    const result = await compileMdxContent('<InfoBox>\n\ncontent\n\n</Gallery>')
    expect(result).not.toBeNull()
  })

  it('returns an error for an unclosed JSX expression', async () => {
    const result = await compileMdxContent('<InfoBox title={unclosed')
    expect(result).not.toBeNull()
  })

  it('returns an error for invalid JSX attribute syntax', async () => {
    const result = await compileMdxContent('<InfoBox title=no-quotes />')
    expect(result).not.toBeNull()
  })

  it('includes a line number in the error', async () => {
    const result = await compileMdxContent('# Line 1\n\n<Unclosed')
    expect(result?.line).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// findUnknownComponents
// ---------------------------------------------------------------------------

describe('findUnknownComponents', () => {
  const known = new Set(['InfoBox', 'Gallery', 'CallToAction'])

  it('returns empty when all components are in the manifest', () => {
    const content = '<InfoBox title="Hi" />\n\n<Gallery />'
    expect(findUnknownComponents(content, known)).toHaveLength(0)
  })

  it('flags a single unknown component', () => {
    const results = findUnknownComponents('<UnknownWidget />', known)
    expect(results).toHaveLength(1)
    expect(results[0]!.name).toBe('UnknownWidget')
    expect(results[0]!.line).toBe(1)
  })

  it('flags multiple unknown components on separate lines', () => {
    const content = '<Unknown1 />\n<InfoBox />\n<Unknown2 />'
    const results = findUnknownComponents(content, known)
    expect(results.map((r) => r.name)).toEqual(['Unknown1', 'Unknown2'])
  })

  it('flags unknown opening tags but not their closing tags', () => {
    const content = '<Unknown>\n\ncontent\n\n</Unknown>'
    const results = findUnknownComponents(content, known)
    expect(results).toHaveLength(1)
    expect(results[0]!.line).toBe(1)
  })

  it('skips components inside fenced code blocks', () => {
    const content = '```jsx\n<UnknownWidget />\n```'
    expect(findUnknownComponents(content, known)).toHaveLength(0)
  })

  it('skips components inside tilde fenced code blocks', () => {
    const content = '~~~\n<UnknownWidget />\n~~~'
    expect(findUnknownComponents(content, known)).toHaveLength(0)
  })

  it('skips indented code blocks (4 spaces)', () => {
    const content = '    <UnknownWidget />'
    expect(findUnknownComponents(content, known)).toHaveLength(0)
  })

  it('resumes flagging after a code fence closes', () => {
    const content = '```\n<Unknown1 />\n```\n\n<Unknown2 />'
    const results = findUnknownComponents(content, known)
    expect(results).toHaveLength(1)
    expect(results[0]!.name).toBe('Unknown2')
  })

  it('returns empty when the known set is empty (no manifest loaded)', () => {
    expect(findUnknownComponents('<AnyComponent />', new Set())).toHaveLength(0)
  })

  it('returns empty when there are no JSX components at all', () => {
    const content = '# Just markdown\n\nSome **bold** and _italic_ text.'
    expect(findUnknownComponents(content, known)).toHaveLength(0)
  })

  it('handles dot-namespaced component names', () => {
    const knownWithNS = new Set([...known, 'Tabs.Panel'])
    expect(findUnknownComponents('<Tabs.Panel />', knownWithNS)).toHaveLength(0)
    expect(findUnknownComponents('<Tabs.Unknown />', knownWithNS)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// findInvalidProps
// ---------------------------------------------------------------------------

const COMPONENT_MANIFEST: ComponentEntry[] = [
  {
    name: 'InfoBox',
    props: [
      { name: 'title', type: 'string', required: true },
      { name: 'type', type: '"info" | "warning" | "danger"', required: false },
    ],
  },
  {
    name: 'CallToAction',
    props: [
      { name: 'href', type: 'string', required: true },
      { name: 'label', type: 'string', required: true },
    ],
  },
]

describe('findInvalidProps', () => {
  it('returns empty when manifest is empty', () => {
    expect(findInvalidProps('<InfoBox title="Hi" />', [])).toHaveLength(0)
  })

  it('returns empty for fully valid props', () => {
    const content = '<InfoBox title="Hello" type="info" />'
    expect(findInvalidProps(content, COMPONENT_MANIFEST)).toHaveLength(0)
  })

  it('flags an unknown prop name', () => {
    const content = '<InfoBox title="Hi" unknownProp="value" />'
    const results = findInvalidProps(content, COMPONENT_MANIFEST)
    expect(results).toHaveLength(1)
    expect(results[0]!.propName).toBe('unknownProp')
    expect(results[0]!.message).toMatch(/Unknown prop/)
  })

  it('flags a missing required prop', () => {
    const content = '<InfoBox />'
    const results = findInvalidProps(content, COMPONENT_MANIFEST)
    expect(results).toHaveLength(1)
    expect(results[0]!.propName).toBe('title')
    expect(results[0]!.message).toMatch(/Required prop/)
  })

  it('flags all missing required props on a component', () => {
    const content = '<CallToAction />'
    const results = findInvalidProps(content, COMPONENT_MANIFEST)
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.propName)).toContain('href')
    expect(results.map((r) => r.propName)).toContain('label')
  })

  it('flags an invalid enum value', () => {
    const content = '<InfoBox title="Hi" type="invalid" />'
    const results = findInvalidProps(content, COMPONENT_MANIFEST)
    expect(results).toHaveLength(1)
    expect(results[0]!.propName).toBe('type')
    expect(results[0]!.message).toMatch(/Invalid value "invalid"/)
    expect(results[0]!.message).toMatch(/"info" \| "warning"/)  // pipe-separated list
  })

  it('accepts each valid enum value', () => {
    for (const val of ['info', 'warning', 'danger']) {
      const content = `<InfoBox title="Hi" type="${val}" />`
      expect(findInvalidProps(content, COMPONENT_MANIFEST)).toHaveLength(0)
    }
  })

  it('does not validate expression props — dynamic values cannot be checked', () => {
    const content = '<InfoBox title="Hi" type={someVariable} />'
    expect(findInvalidProps(content, COMPONENT_MANIFEST)).toHaveLength(0)
  })

  it('handles multi-line tags', () => {
    const content = '<InfoBox\n  title="Hello"\n  type="warning"\n/>'
    expect(findInvalidProps(content, COMPONENT_MANIFEST)).toHaveLength(0)
  })

  it('skips closing tags', () => {
    // </InfoBox> must not be treated as an opening tag missing its required props
    const content = '</InfoBox>'
    expect(findInvalidProps(content, COMPONENT_MANIFEST)).toHaveLength(0)
  })

  it('skips tags inside fenced code blocks', () => {
    const content = '```jsx\n<InfoBox />\n```'
    expect(findInvalidProps(content, COMPONENT_MANIFEST)).toHaveLength(0)
  })

  it('skips indented code block lines', () => {
    const content = '    <InfoBox />'
    expect(findInvalidProps(content, COMPONENT_MANIFEST)).toHaveLength(0)
  })

  it('ignores unknown components — they are handled by findUnknownComponents', () => {
    const content = '<ScheduleWidget date="2026-01-01" />'
    expect(findInvalidProps(content, COMPONENT_MANIFEST)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// findInvalidFrontmatter
// ---------------------------------------------------------------------------

const FM_FIELDS: FrontmatterField[] = [
  { name: 'title', type: 'string', required: true },
  { name: 'date', type: 'string', required: false },
  { name: 'status', type: '"draft" | "published" | "archived"', required: false },
  { name: 'draft', type: 'boolean', required: false },
]

describe('findInvalidFrontmatter', () => {
  it('returns empty when fields list is empty', () => {
    const raw = '---\ntitle: Hello\n---\n'
    expect(findInvalidFrontmatter(raw, [])).toHaveLength(0)
  })

  it('returns empty when the document has no frontmatter block', () => {
    const raw = '# Just body\n'
    expect(findInvalidFrontmatter(raw, FM_FIELDS)).toHaveLength(0)
  })

  it('returns empty for fully valid frontmatter', () => {
    const raw = '---\ntitle: Hello\ndate: 2026-04-27\nstatus: draft\n---\n'
    expect(findInvalidFrontmatter(raw, FM_FIELDS)).toHaveLength(0)
  })

  it('flags an unknown field', () => {
    const raw = '---\ntitle: Hello\nunknownKey: value\n---\n'
    const results = findInvalidFrontmatter(raw, FM_FIELDS)
    expect(results).toHaveLength(1)
    expect(results[0]!.field).toBe('unknownKey')
    expect(results[0]!.message).toMatch(/Unknown frontmatter field/)
  })

  it('flags a missing required field', () => {
    const raw = '---\ndate: 2026-04-27\n---\n'
    const results = findInvalidFrontmatter(raw, FM_FIELDS)
    expect(results).toHaveLength(1)
    expect(results[0]!.field).toBe('title')
    expect(results[0]!.message).toMatch(/Required frontmatter field/)
    expect(results[0]!.line).toBe(1) // points at the opening ---
  })

  it('flags an invalid enum value', () => {
    const raw = '---\ntitle: Hello\nstatus: pending\n---\n'
    const results = findInvalidFrontmatter(raw, FM_FIELDS)
    expect(results).toHaveLength(1)
    expect(results[0]!.field).toBe('status')
    expect(results[0]!.message).toMatch(/Invalid value "pending"/)
    expect(results[0]!.message).toMatch(/"draft" \| "published"/)  // pipe-separated list
  })

  it('accepts each valid enum value', () => {
    for (const val of ['draft', 'published', 'archived']) {
      const raw = `---\ntitle: Hello\nstatus: ${val}\n---\n`
      expect(findInvalidFrontmatter(raw, FM_FIELDS)).toHaveLength(0)
    }
  })

  it('reports multiple issues in the same document', () => {
    // missing required title + unknown field + invalid enum
    const raw = '---\nunknownKey: value\nstatus: bad\n---\n'
    const results = findInvalidFrontmatter(raw, FM_FIELDS)
    const fields = results.map((r) => r.field)
    expect(fields).toContain('title')      // missing required
    expect(fields).toContain('unknownKey') // unknown
    expect(fields).toContain('status')     // invalid enum
  })

  it('provides correct line numbers for flagged keys', () => {
    // title is on line 2 (line 1 is ---), date on line 3, unknownKey on line 4
    const raw = '---\ntitle: Hello\ndate: 2026-01-01\nunknownKey: x\n---\n'
    const results = findInvalidFrontmatter(raw, FM_FIELDS)
    expect(results).toHaveLength(1)
    expect(results[0]!.line).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Save-blocking: linter error severity gates the emit('input') call
//
// The interface only calls emit('input') when onDiagnostics(false) fires,
// i.e. when there are no 'error'-severity diagnostics. These tests verify
// that compileMdxContent — the source of error diagnostics — correctly
// distinguishes valid from invalid MDX, and that warnings (unknown
// components, invalid props) do not have 'error' severity and therefore
// do not block saves.
// ---------------------------------------------------------------------------

describe('save-blocking via linter onDiagnostics', () => {
  it('unclosed JSX expression produces a compile error → blocks save', async () => {
    const raw = '---\ntitle: Draft\ndate: 2026-04-27\n---\n\n<InfoBox title={unclosed\n'
    const { content } = stripFrontmatter(raw)
    const err = await compileMdxContent(content)
    // compileMdxContent error → 'error' severity diagnostic → onDiagnostics(true) → emit suppressed
    expect(err).not.toBeNull()
    expect(err?.message).toBeTruthy()
  })

  it('unclosed JSX tag produces a compile error → blocks save', async () => {
    const { content } = stripFrontmatter('---\ntitle: Test\n---\n\n<InfoBox\n')
    expect(await compileMdxContent(content)).not.toBeNull()
  })

  it('valid full-file MDX produces no compile error → save allowed', async () => {
    const raw = '---\ntitle: Good\ndate: 2026-04-27\n---\n\n<InfoBox title="Hello" type="info" />\n'
    const { content } = stripFrontmatter(raw)
    const err = await compileMdxContent(content)
    // No error → onDiagnostics(false) → emit fires, Directus save proceeds
    expect(err).toBeNull()
  })

  it('unknown component is a warning, not an error → does not block save', async () => {
    // findUnknownComponents produces 'warning' severity, which onDiagnostics ignores
    const { content } = stripFrontmatter('---\ntitle: Test\n---\n\n<NotInManifest />\n')
    // Unknown components are valid JSX — compile succeeds, only the manifest check warns
    expect(await compileMdxContent(content)).toBeNull()
  })

  it('invalid props are warnings, not errors → do not block save', async () => {
    // findInvalidProps produces 'warning' severity diagnostics
    const { content } = stripFrontmatter('---\ntitle: Test\n---\n\n<InfoBox unknownProp="x" />\n')
    expect(await compileMdxContent(content)).toBeNull()
  })

  it('plain markdown with no components produces no compile error', async () => {
    const raw = '---\ntitle: Simple\n---\n\n# Hello\n\nJust text.\n'
    const { content } = stripFrontmatter(raw)
    expect(await compileMdxContent(content)).toBeNull()
  })
})
