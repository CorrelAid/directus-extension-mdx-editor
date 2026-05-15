// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// Stub the format module BEFORE importing createEditor so the keymap
// binding closes over the mock. We assert that createEditor's Mod-s
// binding actually calls formatMdx (not a hand-rolled re-implementation).
const { formatSpy } = vi.hoisted(() => ({
  formatSpy: vi.fn(() => Promise.resolve()),
}))
vi.mock('../format', () => ({
  formatMdx: formatSpy,
  formatMdxString: vi.fn(() => Promise.resolve('')),
}))

import { createEditor, type EditorController } from '../editor'
import type { Manifest } from '../autocomplete'

const manifest: Manifest = { components: [], frontmatter: [] }

let ctrl: EditorController | null = null

beforeEach(() => {
  formatSpy.mockClear()
})

afterEach(() => {
  ctrl?.view.destroy()
  ctrl = null
  document.body.innerHTML = ''
})

function mount(doc = '# Hello'): EditorController {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  ctrl = createEditor(parent, doc, undefined, false, manifest)
  ctrl.view.focus()
  return ctrl
}

function ctrlS(target: EventTarget, key = 's', extra: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...extra,
  })
  target.dispatchEvent(ev)
  return ev
}

describe('createEditor Mod-s keymap wiring', () => {
  it('Ctrl+S inside the editor calls formatMdx', () => {
    const c = mount()
    ctrlS(c.view.contentDOM)
    expect(formatSpy).toHaveBeenCalledTimes(1)
    expect(formatSpy).toHaveBeenCalledWith(c.view)
  })

  it('Ctrl+S preventDefault fires so browser save dialog is suppressed', () => {
    const c = mount()
    const ev = ctrlS(c.view.contentDOM)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('Ctrl+Shift+F also calls formatMdx', () => {
    const c = mount()
    ctrlS(c.view.contentDOM, 'f', { shiftKey: true })
    expect(formatSpy).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+S dispatched outside the editor does NOT call formatMdx', () => {
    mount()
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    const ev = ctrlS(outside)
    expect(formatSpy).not.toHaveBeenCalled()
    expect(ev.defaultPrevented).toBe(false)
  })

  it('readOnly editor: Mod-s still triggers (formatMdx itself short-circuits readOnly)', () => {
    // We assert that the keymap fires unconditionally; formatMdx is the gate.
    // This pins the contract so a future refactor doesn't move the readOnly
    // check into the keymap and silently drop the user's keystroke.
    const c = mount()
    c.setReadOnly(true)
    ctrlS(c.view.contentDOM)
    expect(formatSpy).toHaveBeenCalledTimes(1)
  })
})
