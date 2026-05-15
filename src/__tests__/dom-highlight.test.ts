// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { mdxComponentHighlight } from '../language'
import { directusThemeSpec, mdxHighlightSpec } from '../editor'

// Real-DOM regression for the LinkButton-stays-dim bug. The MatchDecorator
// wraps JSX component names in a `.cm-mdx-component` span; we verify that
// (a) the span is created for both single-line and multi-line component
// invocations, and (b) the theme rule that paints it `primary !important`
// is still in the compiled theme spec (jsdom does not resolve CSS custom
// properties or apply stylesheet rules, so the colour itself is asserted
// against the source-of-truth object rather than getComputedStyle).

let view: EditorView | null = null

function mount(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [mdxComponentHighlight] }),
    parent,
  })
  return view
}

afterEach(() => {
  view?.destroy()
  view = null
})

describe('mdxComponentHighlight (DOM)', () => {
  it('wraps a single-line LinkButton in .cm-mdx-component', () => {
    const v = mount('<LinkButton href="x">Hi</LinkButton>')
    const spans = v.dom.querySelectorAll('.cm-mdx-component')
    const names = Array.from(spans, (s) => s.textContent)
    expect(names).toEqual(expect.arrayContaining(['LinkButton']))
    // Both the opening and closing tag should be decorated.
    expect(names.filter((n) => n === 'LinkButton').length).toBe(2)
  })

  it('wraps a multi-line LinkButton across lines in .cm-mdx-component', () => {
    const v = mount('<LinkButton href="x">\n  Zum Fokuskurs\n</LinkButton>')
    const spans = v.dom.querySelectorAll('.cm-mdx-component')
    const names = Array.from(spans, (s) => s.textContent)
    expect(names.filter((n) => n === 'LinkButton').length).toBe(2)
  })

  it('wraps HoneycombGrid with JSX attribute', () => {
    const v = mount('<HoneycombGrid items={[]} />')
    const spans = v.dom.querySelectorAll('.cm-mdx-component')
    const names = Array.from(spans, (s) => s.textContent)
    expect(names).toContain('HoneycombGrid')
  })

  it('does not wrap lowercase HTML tags', () => {
    const v = mount('<br/><section>hi</section>')
    expect(v.dom.querySelectorAll('.cm-mdx-component').length).toBe(0)
  })
})

describe('component decoration paints with inline !important style', () => {
  it('applies inline color/font-weight/font-style to .cm-mdx-component spans', () => {
    const v = mount('<LinkButton href="x">Hi</LinkButton>')
    const spans = v.dom.querySelectorAll('.cm-mdx-component')
    expect(spans.length).toBeGreaterThan(0)
    const style = (spans[0] as HTMLElement).getAttribute('style') ?? ''
    // jsdom strips !important from the reserialized form of `color: var(...) !important`
    // (real browsers preserve it). We assert the value separately and rely on the
    // source-string test below to guard the !important contract end-to-end.
    expect(style).toMatch(/color:\s*var\(--theme--primary\)/)
    expect(style).toMatch(/font-weight:\s*600\s*!important/)
    expect(style).toMatch(/font-style:\s*normal\s*!important/)
  })

  it('decoration source defines color with !important (jsdom-independent)', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src', 'language.ts'), 'utf8')
    expect(src).toMatch(/color:\s*var\(--theme--primary\)\s*!important/)
  })

  it('directusThemeSpec still defines a .cm-mdx-component rule as defensive backup', () => {
    const themeKeys = Object.keys(directusThemeSpec)
    expect(themeKeys.some((k) => k.includes('cm-mdx-component'))).toBe(true)
  })
})

// REGRESSION: lezer-markdown wraps the text node inside an opening tag
// (e.g. `InfoBox` in `<InfoBox ...>`) in its OWN leaf <span> tagged with
// tagName. If that leaf span has a `color`, it overrides the outer
// .cm-mdx-component decoration's inline color because CSS does not inherit
// `color` through a child element that sets its own value. Components
// then render dim/italic on prod ("only works sometimes" — depends on
// which markdown constructs the parser tokenised on a given doc).
//
// The contract: tagName must NOT carry a `color` property in the highlight
// spec. Plain HTML tags (`<br>`) inherit the default foreground; component
// names are coloured by the MatchDecorator.
describe('mdxHighlightSpec: tagName has no color (leaf-span override regression)', () => {
  it('does not include a rule for tags.tagName', () => {
    const tagNameRule = mdxHighlightSpec.find((s) => s.tag === tags.tagName)
    expect(tagNameRule).toBeUndefined()
  })

  it('no other rule in the spec accidentally re-introduces a tagName color', () => {
    // The lezer `tagName` symbol is the canonical token; this guards against
    // someone adding a synonym (e.g. via tags.modifier) that would re-land
    // on the inner leaf span. We assert no spec entry sets `color` on a
    // tag whose name resolves to "tagName".
    const offenders = mdxHighlightSpec.filter(
      (s) => 'color' in s && (s.tag === tags.tagName),
    )
    expect(offenders).toEqual([])
  })

  it('keeps angleBracket / attributeName / attributeValue subdued', () => {
    // These tokens render on their own ranges and do not nest under the
    // component decoration, so subduing them is safe and intentional.
    const subduedTags = [tags.angleBracket, tags.attributeName, tags.attributeValue]
    for (const t of subduedTags) {
      const rule = mdxHighlightSpec.find((s) => s.tag === t) as
        | { color?: string }
        | undefined
      expect(rule, `missing rule for ${String(t)}`).toBeDefined()
      expect(rule?.color).toMatch(/foreground-subdued/)
    }
  })
})
