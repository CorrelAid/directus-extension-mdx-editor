<template>
  <div class="mdx-editor" :class="{ 'mdx-editor--disabled': disabled }">
    <p v-if="fetchError" class="mdx-editor__banner mdx-editor__banner--warning">
      <span>Could not load component manifest from <code>{{ manifestUrl }}</code>. Autocomplete is unavailable.</span>
      <button class="mdx-editor__retry" @click="retryManifest">Retry</button>
    </p>
    <p v-if="hasSyntaxErrors" class="mdx-editor__banner mdx-editor__banner--error">
      Syntax error — fix the highlighted problem before this content can be saved.
    </p>

    <div ref="container" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { createEditor, type EditorController } from './editor'
import { buildCompletionSource, parseManifest, type Manifest } from './autocomplete'
import { decideOnDocChange, decideOnLintResult, type EmitState } from './emit-policy'

const props = defineProps<{
  value: string | null
  disabled?: boolean
  manifestUrl?: string
}>()

const emit = defineEmits<{
  (e: 'input', value: string): void
}>()

const container = ref<HTMLElement | null>(null)
const fetchError = ref(false)
const hasSyntaxErrors = ref(false)

let ctrl: EditorController | null = null
let suppressNextWatch = false
let emitState: EmitState = { lastEmitted: '', hasSyntaxErrors: false }

// ---------------------------------------------------------------------------
// Editor factory
// ---------------------------------------------------------------------------

function buildEditor(
  initialContent: string,
  manifest: Manifest,
  completionSource: ReturnType<typeof buildCompletionSource> | undefined,
) {
  emitState = { lastEmitted: initialContent, hasSyntaxErrors: false }
  return createEditor(
    container.value!,
    initialContent,
    completionSource,
    props.disabled ?? false,
    manifest,
    (newValue) => {
      const decision = decideOnDocChange(emitState, newValue)
      if (decision.kind === 'skip') return
      emitState = decision.nextState
      suppressNextWatch = true
      emit('input', decision.value)
    },
    (hasErrors) => {
      hasSyntaxErrors.value = hasErrors
      const currentDoc = ctrl ? ctrl.view.state.doc.toString() : emitState.lastEmitted
      const decision = decideOnLintResult(emitState, hasErrors, currentDoc)
      if (decision.kind === 'skip') {
        emitState = { ...emitState, hasSyntaxErrors: hasErrors }
        return
      }
      emitState = decision.nextState
      suppressNextWatch = true
      emit('input', decision.value)
    },
  )
}

// ---------------------------------------------------------------------------
// Manifest fetch
// ---------------------------------------------------------------------------

async function fetchManifest(): Promise<unknown[] | null> {
  if (!props.manifestUrl) return null
  try {
    const res = await fetch(props.manifestUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return null
  }
}

async function retryManifest() {
  if (!container.value || !ctrl) return
  const fetched = await fetchManifest()
  if (!fetched) return

  const currentContent = ctrl.view.state.doc.toString()
  ctrl.view.destroy()
  fetchError.value = false

  const manifest = parseManifest(fetched)
  ctrl = buildEditor(currentContent, manifest, buildCompletionSource(manifest))
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(async () => {
  let manifest: Manifest = { components: [], frontmatter: [] }
  let completionSource: ReturnType<typeof buildCompletionSource> | undefined

  if (props.manifestUrl) {
    const fetched = await fetchManifest()
    if (fetched) {
      manifest = parseManifest(fetched)
      completionSource = buildCompletionSource(manifest)
    } else {
      fetchError.value = true
    }
  }

  ctrl = buildEditor(props.value ?? '', manifest, completionSource)
})

onBeforeUnmount(() => {
  ctrl?.view.destroy()
  ctrl = null
})

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------

watch(
  () => props.disabled,
  (d) => ctrl?.setReadOnly(d ?? false),
)

watch(
  () => props.value,
  (newVal) => {
    if (suppressNextWatch) {
      suppressNextWatch = false
      return
    }
    if (!ctrl) return
    const current = ctrl.view.state.doc.toString()
    const incoming = newVal ?? ''
    if (incoming !== current) {
      emitState = { ...emitState, lastEmitted: incoming }
      ctrl.view.dispatch({
        changes: { from: 0, to: ctrl.view.state.doc.length, insert: incoming },
      })
    }
  },
)
</script>

<style scoped>
.mdx-editor {
  border: var(--theme--border-width, 2px) solid var(--theme--form--field--input--border-color);
  border-radius: var(--theme--border-radius, 6px);
  overflow: hidden;
  font-family: var(--theme--fonts--monospace--font-family, monospace);
}

.mdx-editor:focus-within {
  border-color: var(--theme--primary);
}

.mdx-editor :deep(.cm-editor) {
  min-height: 400px;
}

.mdx-editor :deep(.cm-scroller) {
  font-family: var(--theme--fonts--monospace--font-family, monospace);
  font-size: 13px;
  line-height: 1.6;
}

.mdx-editor--disabled {
  cursor: not-allowed;
  opacity: var(--theme--form--field--input--disabled--opacity, 0.6);
}

.mdx-editor--disabled :deep(.cm-editor) {
  pointer-events: none;
}

/* Banners */
.mdx-editor__banner {
  margin: 0;
  padding: 8px 12px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.mdx-editor__banner--warning {
  background: color-mix(in srgb, var(--theme--warning) 12%, transparent);
  color: var(--theme--warning);
}

.mdx-editor__banner--error {
  background: color-mix(in srgb, var(--theme--danger) 12%, transparent);
  color: var(--theme--danger);
}

.mdx-editor__retry {
  margin-left: auto;
  padding: 2px 10px;
  border: 1px solid currentColor;
  border-radius: var(--theme--border-radius, 4px);
  background: transparent;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}

.mdx-editor__retry:hover {
  background: color-mix(in srgb, currentColor 10%, transparent);
}
</style>
