import {
  MatchDecorator,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
  type EditorView,
} from '@codemirror/view'

// Visually distinguish JSX component names (<ComponentName, </ComponentName)
// from plain markdown and HTML. Works as a view-layer overlay on top of
// @codemirror/lang-markdown without needing a custom Lezer grammar.
// HTML element highlighting is handled via HighlightStyle tokens (tagName,
// angleBracket, etc.) which the @lezer/markdown parser already emits.
const componentMatcher = new MatchDecorator({
  regexp: /<\/?([A-Z][A-Za-z0-9.]*)/g,
  decorate: (add, from, to, match) => {
    const bracketLen = match[0].startsWith('</') ? 2 : 1
    add(from, from + bracketLen, Decoration.mark({ class: 'cm-mdx-bracket' }))
    add(from + bracketLen, to, Decoration.mark({ class: 'cm-mdx-component' }))
  },
})

export const mdxComponentHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = componentMatcher.createDeco(view) }
    update(update: ViewUpdate) { this.decorations = componentMatcher.updateDeco(update, this.decorations) }
  },
  { decorations: (v) => v.decorations },
)
