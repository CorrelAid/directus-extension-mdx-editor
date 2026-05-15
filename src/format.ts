import type { EditorView } from '@codemirror/view'

export async function formatMdxString(doc: string): Promise<string> {
  const [
    { unified },
    { default: remarkParse },
    { default: remarkMdx },
    { default: remarkStringify },
    { default: remarkFrontmatter },
  ] = await Promise.all([
    import('unified'),
    import('remark-parse'),
    import('remark-mdx'),
    import('remark-stringify'),
    import('remark-frontmatter'),
  ])

  const file = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkMdx)
    .use(remarkStringify, {
      bullet: '-',
      fences: true,
      rule: '-',
      emphasis: '_',
      strong: '*',
      listItemIndent: 'one',
    })
    .process(doc)
  return String(file)
}

export async function formatMdx(view: EditorView): Promise<void> {
  if (view.state.readOnly) return
  const doc = view.state.doc.toString()
  let out: string
  try {
    out = await formatMdxString(doc)
  } catch {
    return
  }
  if (out === doc) return
  const anchor = Math.min(view.state.selection.main.anchor, out.length)
  view.dispatch({
    changes: { from: 0, to: doc.length, insert: out },
    selection: { anchor },
  })
}
