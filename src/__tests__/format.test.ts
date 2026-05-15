import { describe, it, expect } from 'vitest'
import { formatMdxString } from '../format'

// Guards remark-stringify fidelity for the JSX patterns used in this repo.
// remark-stringify is known to rewrite whitespace, quotes, and bullet style;
// these tests pin the output for representative MDX inputs so we notice
// when a remark version bump changes the contract before binding the
// formatter to autosave.

describe('formatMdxString — JSX fidelity', () => {
  it('preserves a single-line JSX component with string attrs', async () => {
    const input = '<LinkButton href="https://example.com" size="compact" variant="primary">Zum Kurs</LinkButton>\n'
    const out = await formatMdxString(input)
    expect(out).toContain('<LinkButton')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('size="compact"')
    expect(out).toContain('variant="primary"')
    expect(out).toContain('Zum Kurs')
    expect(out).toContain('</LinkButton>')
  })

  it('preserves a JSX component with an array-of-object expression prop', async () => {
    const input = `<HoneycombGrid items={[
  { title: "A", href: "https://example.com/a" },
  { title: "B", href: "https://example.com/b" },
]} />\n`
    const out = await formatMdxString(input)
    expect(out).toContain('<HoneycombGrid')
    expect(out).toContain('items=')
    expect(out).toContain('title:')
    expect(out).toContain('https://example.com/a')
    expect(out).toContain('https://example.com/b')
    expect(out).toContain('/>')
  })

  it('preserves YAML frontmatter block', async () => {
    const input = '---\ntitle: Test\nslug: test\n---\n\n# Body\n'
    const out = await formatMdxString(input)
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('title: Test')
    expect(out).toContain('slug: test')
    expect(out).toContain('# Body')
  })

  it('preserves self-closing JSX with <br/> inside an attribute value', async () => {
    const input = '<HoneycombGrid items={[{ title: "Foo<br/>Bar" }]} />\n'
    const out = await formatMdxString(input)
    expect(out).toContain('Foo<br/>Bar')
  })

  it('round-trip is stable (formatting twice yields the same output)', async () => {
    const input = '# Hello\n\n<LinkButton href="x">y</LinkButton>\n'
    const once = await formatMdxString(input)
    const twice = await formatMdxString(once)
    expect(twice).toBe(once)
  })

  it('throws on malformed JSX so caller can no-op', async () => {
    await expect(formatMdxString('<LinkButton href="x">unclosed\n')).rejects.toBeTruthy()
  })
})
