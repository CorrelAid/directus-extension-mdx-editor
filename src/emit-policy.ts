// Pure decision functions for when the MDX interface should emit `input`
// back to Directus. Extracted so they can be unit-tested without mounting
// the whole Vue component.

export interface EmitState {
  lastEmitted: string
  hasSyntaxErrors: boolean
}

export type EmitDecision =
  | { kind: 'skip' }
  | { kind: 'emit'; value: string; nextState: EmitState }

// Called whenever CodeMirror dispatches a doc change.
export function decideOnDocChange(state: EmitState, newValue: string): EmitDecision {
  if (state.hasSyntaxErrors) return { kind: 'skip' }
  if (newValue === state.lastEmitted) return { kind: 'skip' }
  return {
    kind: 'emit',
    value: newValue,
    nextState: { ...state, lastEmitted: newValue },
  }
}

// Called whenever the linter reports the current error state. `currentDoc`
// is the editor's doc at the time of the report. Only flushes content when
// the document transitions from "has errors" to "valid" — never on the
// initial pass for a clean doc (which previously wiped saved content on
// prod when the editor mounted before `props.value` arrived).
export function decideOnLintResult(
  state: EmitState,
  hasErrors: boolean,
  currentDoc: string,
): EmitDecision {
  const transitioningToValid = state.hasSyntaxErrors && !hasErrors
  const nextErrorState = { ...state, hasSyntaxErrors: hasErrors }
  if (!transitioningToValid) {
    return { kind: 'skip' }
  }
  if (currentDoc === state.lastEmitted) {
    return { kind: 'skip' }
  }
  return {
    kind: 'emit',
    value: currentDoc,
    nextState: { ...nextErrorState, lastEmitted: currentDoc },
  }
}
