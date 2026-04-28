import { EditorView, keymap, lineNumbers, highlightActiveLine, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { autocompletion, completionKeymap, type CompletionSource } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { mdxComponentHighlight } from './language'
import { mdxLinter } from './linter'
import type { Manifest } from './autocomplete'

// Minimal highlight style: keeps bold/italic/strikethrough/code but omits link
// underlines and escape-sequence colouring, which cause visual noise in MDX
// content that mixes JS export blocks with embedded markdown strings.
const mdxHighlightStyle = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.heading, fontWeight: 'bold' },
  { tag: tags.monospace, fontFamily: 'inherit' },
  // HTML elements parsed by @lezer/markdown — subdued so they don't compete
  // with MDX component names styled by the MatchDecorator in language.ts.
  { tag: tags.tagName, color: 'var(--theme--foreground-subdued)', fontStyle: 'italic' },
  { tag: tags.angleBracket, color: 'var(--theme--foreground-subdued)' },
  { tag: tags.attributeName, color: 'var(--theme--foreground-subdued)' },
  { tag: tags.attributeValue, color: 'var(--theme--foreground-subdued)' },
]))

export interface EditorController {
  view: EditorView
  setReadOnly: (disabled: boolean) => void
}

// Decorates the YAML frontmatter block (lines between the opening and closing ---) with a
// distinct line class so it can be styled separately from the markdown body.
const frontmatterLineDecoration = Decoration.line({ class: 'cm-frontmatter-line' })

const frontmatterHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildFrontmatterDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = buildFrontmatterDecorations(update.view)
    }
  },
  { decorations: (v) => v.decorations },
)

function buildFrontmatterDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  if (doc.lines < 2 || doc.line(1).text !== '---') return builder.finish()

  let closingLine = -1
  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text === '---') { closingLine = i; break }
  }
  if (closingLine === -1) return builder.finish()

  for (let i = 1; i <= closingLine; i++) {
    const { from } = doc.line(i)
    builder.add(from, from, frontmatterLineDecoration)
  }
  return builder.finish()
}

// Maps to Directus CSS custom properties so the editor adapts to light/dark theme automatically
const directusTheme = EditorView.theme({
  '&': {
    color: 'var(--theme--foreground)',
    backgroundColor: 'var(--theme--form--field--input--background)',
    height: '100%',
  },
  '.cm-content': {
    caretColor: 'var(--theme--primary)',
    padding: '12px 16px',
    minHeight: '400px',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--theme--primary)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--theme--primary) 20%, transparent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--theme--foreground) 4%, transparent)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--theme--background-subdued)',
    color: 'var(--theme--foreground-subdued)',
    border: 'none',
    borderRight: '1px solid var(--theme--border-color-subdued)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px',
    minWidth: '32px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    border: '1px solid var(--theme--border-color)',
    borderRadius: 'var(--theme--border-radius)',
    backgroundColor: 'var(--theme--background)',
    boxShadow: 'var(--theme--card-shadow)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    fontFamily: 'var(--theme--fonts--monospace--font-family)',
    fontSize: '13px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--theme--primary)',
    color: 'var(--theme--primary-foreground)',
  },
  '.cm-frontmatter-line': {
    backgroundColor: 'color-mix(in srgb, var(--theme--primary) 6%, transparent)',
  },
  // MDX component tokens (applied by the MatchDecorator in language.ts)
  '.cm-mdx-bracket': {
    color: 'var(--theme--foreground-subdued)',
  },
  '.cm-mdx-component': {
    color: 'var(--theme--primary)',
    fontWeight: '600',
  },
  // Linter squiggles
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    borderBottom: '2px solid var(--theme--danger)',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    borderBottom: '2px solid var(--theme--warning)',
  },
})

export function createEditor(
  parent: HTMLElement,
  initialValue: string,
  completionSource: CompletionSource | undefined,
  disabled: boolean,
  manifest: Manifest,
  onChange?: (value: string) => void,
  onHasErrors?: (hasErrors: boolean) => void,
): EditorController {
  const readOnlyCompartment = new Compartment()

  const extensions = [
    lineNumbers(),
    history(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    readOnlyCompartment.of(EditorState.readOnly.of(disabled)),
    frontmatterHighlight,
    mdxComponentHighlight,

    mdxLinter(manifest, onHasErrors),
    markdown(),
    mdxHighlightStyle,
    keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
    directusTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && onChange) {
        onChange(update.state.doc.toString())
      }
    }),
  ]

  if (completionSource) {
    extensions.push(autocompletion({ override: [completionSource] }))
  } else {
    extensions.push(autocompletion())
  }

  const view = new EditorView({
    state: EditorState.create({ doc: initialValue, extensions }),
    parent,
  })

  return {
    view,
    setReadOnly: (d: boolean) =>
      view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(d)) }),
  }
}
