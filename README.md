# directus-extension-mdx-body-editor

A Directus interface extension that replaces the plain textarea on `text` fields with a full-featured MDX editor.

**Features**

- CodeMirror 6 editor with Markdown syntax highlighting
- Frontmatter block (`---`) visually distinguished from the body
- JSX component names (`<InfoBox>`) highlighted in the editor
- **Autocomplete** — type `<` for component names, continue typing for prop names, type `="` for enum values. Driven by a JSON manifest URL you configure per-field.
- **Linter** — two passes debounced at 750 ms:
  - MDX syntax errors (unclosed tags, bad expressions) → red underline
  - Component names absent from the manifest → orange underline
- Respects Directus light/dark theme via CSS custom properties
- Respects the field's `disabled`/read-only state

---

## Local development

### Prerequisites

- Node.js 18+
- Docker (for the local Directus instance)

### First run

```bash
npm install
npm run preview
```

`preview` does everything in one shot:

1. Builds the extension (`dist/index.js`)
2. Runs `docker compose up -d` — starts Directus on <http://localhost:8055> with the extension mounted as a volume
3. Starts a local manifest server on <http://localhost:3333> (required for autocomplete/linting to work in the browser)
4. Waits for Directus to be healthy, then creates a `mdx_preview` collection with a `body` field wired to this extension
5. Seeds four sample items that exercise every editor feature (see below)
6. Prints clickable URLs and **stays running** — the manifest server must be alive for the editor to fetch component definitions

Press `Ctrl+C` to stop the manifest server. Directus keeps running.

```bash
docker compose down        # stop Directus
docker compose down -v     # also wipe the SQLite database
```

### Watch mode (code → browser in ~1 s)

In a second terminal, run the extension compiler in watch mode:

```bash
npm run dev
```

Directus is configured with `EXTENSIONS_AUTO_RELOAD=true` and `EXTENSIONS_CACHE_TTL=1s`, so saving any source file triggers a rebuild and the browser reflects the change on the next page load.

### Unit tests

```bash
npm test             # single run
npm run test:watch   # re-run on save
```

Tests cover the pure linter logic: `stripFrontmatter`, `compileMdxContent` (via `@mdx-js/mdx`), and `findUnknownComponents`. No browser required.

### Sample items

| Item | Purpose |
|------|---------|
| **01 — Full-featured** | Valid MDX using all three manifest components — autocomplete and no warnings |
| **02 — Unknown component** | `<ScheduleWidget>` is not in the manifest — orange warning squiggle |
| **03 — Syntax error** | Unclosed JSX expression — red error squiggle from the MDX compiler |
| **04 — Plain markdown** | Frontmatter tint only, no components |

---

## Component manifest

The manifest is a JSON object that drives autocomplete and linting. Host it anywhere your Directus instance can `fetch` it (CORS must be open to the Directus origin).

```jsonc
// manifest.example.json — copy and extend this for your project
{
  // Frontmatter field definitions — validated against the YAML block at the top of each file
  "frontmatter": [
    { "name": "title",  "type": "string",  "required": true  },
    { "name": "date",   "type": "string",  "required": true  },
    { "name": "draft",  "type": "boolean", "required": false },
    { "name": "tags",   "type": "string[]","required": false }
  ],
  // JSX component definitions — drives autocomplete and prop validation
  "components": [
    {
      "name": "InfoBox",
      "description": "Highlighted callout block",
      "props": [
        { "name": "title", "type": "string",                              "required": true  },
        { "name": "type",  "type": "\"info\" | \"warning\" | \"danger\"", "required": false }
      ]
    }
  ]
}
```

The legacy array format (`[{ "name": "InfoBox", ... }]`) is still accepted and treated as `{ components: [...], frontmatter: [] }`.

**`type` field conventions**

| You write | Linter behaviour | Autocomplete |
|-----------|-----------------|--------------|
| `"string"` | Accepts any string | No value suggestions |
| `"boolean"` | Accepts `true` / `false` | — |
| `"number"` | No value check | No value suggestions |
| `"string[]"` | No value check | — |
| `"\"a\" \| \"b\""` | Flags values not in the set | Offers `a` and `b` inside `=""` |

---

## Including the extension in a self-hosted Directus instance

### Option A — volume mount (simplest for single-server deployments)

Build the extension and copy the two files Directus needs into your extensions directory:

```bash
npm run build
cp package.json   /path/to/directus/extensions/mdx-body-editor/package.json
cp -r dist        /path/to/directus/extensions/mdx-body-editor/dist
```

Or with Docker Compose, mount the built output directly:

```yaml
services:
  directus:
    image: directus/directus:latest
    volumes:
      - ./package.json:/directus/extensions/mdx-body-editor/package.json:ro
      - ./dist:/directus/extensions/mdx-body-editor/dist
    environment:
      EXTENSIONS_AUTO_RELOAD: "true"
```

Directus discovers the extension via the `directus:extension` field in `package.json` and loads `dist/index.js`.

### Option B — custom Docker image (recommended for production)

Build the extension locally (`npm run build`), then bake it into a Docker image:

```dockerfile
FROM directus/directus:latest

COPY --chown=node:node package.json   /directus/extensions/mdx-body-editor/package.json
COPY --chown=node:node dist/          /directus/extensions/mdx-body-editor/dist/
```

Build and push this image instead of using `directus/directus:latest` directly.

### Option C — build from GitHub (no local clone needed)

Use a multi-stage Dockerfile. Stage 1 clones the repository and compiles the extension; stage 2 copies only the built artefacts into the final Directus image. Nothing is committed to your own repository.

```dockerfile
# ── Stage 1: build the extension ────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build
RUN git clone --depth 1 https://github.com/CorrelAid/directus-extension-mdx-editor.git .

RUN npm ci && npm run build

# ── Stage 2: Directus with the extension baked in ───────────────────────────
FROM directus/directus:latest

COPY --from=builder --chown=node:node /build/package.json \
     /directus/extensions/mdx-body-editor/package.json
COPY --from=builder --chown=node:node /build/dist \
     /directus/extensions/mdx-body-editor/dist
```

To pin a specific release, replace `--depth 1` with `--branch v1.2.3 --depth 1`.

Build and push:

```bash
docker build -t your-registry/directus-with-mdx-editor:latest .
docker push your-registry/directus-with-mdx-editor:latest
```

Then reference that image in your `docker-compose.yml`:

```yaml
services:
  directus:
    image: your-registry/directus-with-mdx-editor:latest
```

### Content-Security-Policy

Directus ships with a CSP that only allows `https://` origins for `connect-src`. The browser-side manifest fetch will be blocked unless you add your manifest host to the policy.

In your Directus environment (`.env` or Docker Compose):

```env
CONTENT_SECURITY_POLICY_DIRECTIVES__CONNECT_SRC="'self' https://* wss://* https://your-manifest-host.example.com"
```

The local dev `docker-compose.yml` already includes `http://localhost:*` for this reason.

### After deployment

1. In the Directus admin go to **Settings → Data Model**
2. Open or create a collection
3. Add a field of type **Text** (long text / `text`)
4. Set the **Interface** to **MDX Body Editor**
5. In the interface options paste the URL to your manifest JSON

If you don't have a manifest yet, leave the URL blank — the editor still works, autocomplete just won't suggest components and unknown-component warnings are suppressed.

---

## Project layout

```
src/
  index.ts          registerinterface with Directus (defineInterface)
  interface.vue     Vue 3 component — mounts the editor, fetches manifest
  editor.ts         CodeMirror 6 setup, theme, disabled/readOnly handling
  language.ts       MatchDecorator overlay — highlights <ComponentName> tokens
  autocomplete.ts   CompletionSource built from the manifest
  linter.ts         Two-pass linter: MDX compile errors + unknown components
  __tests__/
    linter.test.ts  Unit tests for the pure linter functions

scripts/
  preview.js        One-command local preview (build + docker + seed data)
  setup-test.js     Minimal API-only setup (no manifest server, no Docker)

manifest.example.json   Example manifest — use as a template
docker-compose.yml      Local Directus instance with extension mounted
vitest.config.ts        Test runner config (handles ESM deps)
```
