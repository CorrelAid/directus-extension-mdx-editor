import { describe, it, expect } from 'vitest'
import {
  decideOnDocChange,
  decideOnLintResult,
  type EmitState,
} from '../emit-policy'

// Regression: production reports of "MDX field content disappears suddenly".
// Root cause was that the linter callback used to emit `''` on its initial
// pass (no errors on an empty doc) before `props.value` arrived from
// Directus, wiping the saved content. These tests pin the new behaviour.

const initial = (): EmitState => ({ lastEmitted: '# Hello', hasSyntaxErrors: false })

describe('decideOnDocChange', () => {
  it('emits on user-typed change to a valid doc', () => {
    const d = decideOnDocChange(initial(), '# Hello world')
    expect(d.kind).toBe('emit')
    if (d.kind === 'emit') {
      expect(d.value).toBe('# Hello world')
      expect(d.nextState.lastEmitted).toBe('# Hello world')
    }
  })

  it('skips when value equals lastEmitted (idempotent)', () => {
    expect(decideOnDocChange(initial(), '# Hello').kind).toBe('skip')
  })

  it('skips while syntax errors are present', () => {
    const s: EmitState = { lastEmitted: '# Hello', hasSyntaxErrors: true }
    expect(decideOnDocChange(s, '# Hello typing').kind).toBe('skip')
  })
})

describe('decideOnLintResult', () => {
  it('REGRESSION: does NOT emit on the initial lint pass of a clean doc', () => {
    // Editor mounts with `''` because props.value is still loading from Directus.
    // Linter immediately reports `hasErrors=false`. Old code would emit `''`
    // here, wiping the persisted record.
    const s: EmitState = { lastEmitted: '', hasSyntaxErrors: false }
    const d = decideOnLintResult(s, false, '')
    expect(d.kind).toBe('skip')
  })

  it('REGRESSION: does not emit on a fresh editor when there are no errors', () => {
    const s: EmitState = { lastEmitted: '# Already saved', hasSyntaxErrors: false }
    const d = decideOnLintResult(s, false, '# Already saved')
    expect(d.kind).toBe('skip')
  })

  it('REGRESSION: does not re-emit while errors stay false (no spurious passes)', () => {
    const s: EmitState = { lastEmitted: '# Doc', hasSyntaxErrors: false }
    // Lint runs again, still clean — must not emit.
    expect(decideOnLintResult(s, false, '# Doc').kind).toBe('skip')
  })

  it('emits once on transition errors -> valid (flushes after user fixes syntax)', () => {
    const s: EmitState = { lastEmitted: '# Old', hasSyntaxErrors: true }
    const d = decideOnLintResult(s, false, '# Fixed content')
    expect(d.kind).toBe('emit')
    if (d.kind === 'emit') {
      expect(d.value).toBe('# Fixed content')
      expect(d.nextState).toEqual({ lastEmitted: '# Fixed content', hasSyntaxErrors: false })
    }
  })

  it('does not emit on transition if the doc has not changed since last emit', () => {
    const s: EmitState = { lastEmitted: '# Same', hasSyntaxErrors: true }
    expect(decideOnLintResult(s, false, '# Same').kind).toBe('skip')
  })

  it('skips when errors are still present', () => {
    const s: EmitState = { lastEmitted: '# Doc', hasSyntaxErrors: true }
    expect(decideOnLintResult(s, true, '# Doc broken').kind).toBe('skip')
  })

  it('skips when errors are newly introduced', () => {
    const s: EmitState = { lastEmitted: '# Doc', hasSyntaxErrors: false }
    expect(decideOnLintResult(s, true, '# Doc <Broken').kind).toBe('skip')
  })
})
