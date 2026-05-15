import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Regex copy from src/language.ts. Kept in sync intentionally so the test
// fails if the matcher is narrowed and stops covering JSX component opens
// on lines that the markdown parser also recognises as inline HTML
// (e.g. single-line `<LinkButton ...>x</LinkButton>`) which would otherwise
// be painted by the tagName HighlightStyle and lose the component color.
const componentRegex = /<\/?([A-Z][A-Za-z0-9.]*)/g

function matches(input: string): string[] {
  return Array.from(input.matchAll(componentRegex), (m) => m[1])
}

describe('mdx component matcher regex', () => {
  it('matches single-line LinkButton open and close', () => {
    const doc = '<LinkButton href="x" size="compact">Zum Kurs</LinkButton>'
    expect(matches(doc)).toEqual(['LinkButton', 'LinkButton'])
  })

  it('matches multiline LinkButton wrapping content', () => {
    const doc = '<LinkButton href="x">\n  Zum Fokuskurs\n</LinkButton>'
    expect(matches(doc)).toEqual(['LinkButton', 'LinkButton'])
  })

  it('matches HoneycombGrid with JSX attribute', () => {
    const doc = '<HoneycombGrid items={[\n  { title: "a" },\n]} />'
    expect(matches(doc)).toEqual(['HoneycombGrid'])
  })

  it('matches dotted component names', () => {
    expect(matches('<Foo.Bar />')).toEqual(['Foo.Bar'])
  })

  it('ignores lowercase HTML tags', () => {
    expect(matches('<br/><section><div>')).toEqual([])
  })
})

describe('mdx component CSS specificity (regression for #linkbutton-dim)', () => {
  it('cm-mdx-component color uses !important to beat tok-tagName', () => {
    // The lezer-markdown parser tokenises single-line `<LinkButton ...>x</LinkButton>`
    // as inline HTML and emits tagName, which our HighlightStyle paints
    // foreground-subdued italic. The MatchDecorator overlay must win.
    const src = readFileSync(join(__dirname, '..', 'editor.ts'), 'utf8')
    expect(src).toMatch(/\.cm-mdx-component[^{]*\{[^}]*color:[^;]*!important/)
  })
})
