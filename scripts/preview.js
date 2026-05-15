#!/usr/bin/env node
/**
 * scripts/preview.js — One-command local preview setup.
 *
 * What it does:
 *   1. Builds the extension  (npm run build)
 *   2. Starts Directus       (docker compose up -d)
 *   3. Serves manifest.example.json on :3333 for autocomplete + linting
 *   4. Waits for Directus to be healthy
 *   5. Creates the preview collection + MDX body field (idempotent)
 *   6. Seeds 4 items that cover every editor feature
 *   7. Keeps the manifest server alive and prints clickable URLs
 *
 * Usage:
 *   node scripts/preview.js
 *   ADMIN_PASSWORD=secret MANIFEST_PORT=4444 node scripts/preview.js
 */

const { execSync, spawnSync } = require('node:child_process')
const { createServer } = require('node:http')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT          = join(__dirname, '..')
const BASE          = process.env.DIRECTUS_URL   ?? 'http://localhost:8055'
const EMAIL         = process.env.ADMIN_EMAIL    ?? 'admin@example.com'
const PASSWORD      = process.env.ADMIN_PASSWORD ?? 'admin'
const MANIFEST_PORT = parseInt(process.env.MANIFEST_PORT ?? '3333', 10)
const MANIFEST_URL  = `http://localhost:${MANIFEST_PORT}/components-manifest.json`
const COLLECTION    = 'mdx_preview'

// ---------------------------------------------------------------------------
// Manifest HTTP server
// ---------------------------------------------------------------------------

function startManifestServer() {
  const payload = readFileSync(join(ROOT, 'manifest.example.json'))

  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    if (req.url === '/components-manifest.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(payload)
    } else {
      res.writeHead(404); res.end()
    }
  })

  server.listen(MANIFEST_PORT, () =>
    console.log(`✓ Manifest server → ${MANIFEST_URL}`),
  )

  return server
}

// ---------------------------------------------------------------------------
// Directus REST helpers
// ---------------------------------------------------------------------------

async function api(path, method = 'GET', body = undefined, token = undefined) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = json.errors?.[0]?.message ?? res.statusText
    throw Object.assign(new Error(msg), { status: res.status, code: json.errors?.[0]?.extensions?.code, body: json })
  }
  return json
}

async function waitForDirectus(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE}/server/health`)
      if (res.ok) return
    } catch { /* not ready yet */ }
    if (i === retries - 1) throw new Error(`Directus not reachable at ${BASE} after ${retries * 2}s`)
    process.stdout.write(`\r  Waiting for Directus… ${i + 1}/${retries}`)
    await new Promise(r => setTimeout(r, 2000))
  }
  process.stdout.write('\n')
}

async function createOrSkip(label, fn) {
  try {
    const result = await fn()
    console.log(`✓ ${label}`)
    return result
  } catch (err) {
    if (err.status === 400 || err.code === 'RECORD_NOT_UNIQUE') {
      console.log(`  ${label} — already exists, skipping`)
      return null
    }
    throw err
  }
}

// Directus 11 does not automatically grant item-level CRUD to the admin role
// on user-created collections — admin_access controls schema/system operations
// but data access still requires explicit permissions. Grant them here.
async function grantAdminCrud(collection, token) {
  const { data: me } = await api('/users/me?fields=role', 'GET', undefined, token)
  const roleId = me.role
  if (!roleId) return

  for (const action of ['create', 'read', 'update', 'delete']) {
    try {
      await api('/permissions', 'POST', {
        role: roleId,
        collection,
        action,
        fields: ['*'],
        permissions: {},
        validation: {},
      }, token)
    } catch {
      // Already exists or admin already bypasses policies — both are fine.
    }
  }
  console.log(`✓ Admin CRUD permissions set on "${collection}"`)
}

// ---------------------------------------------------------------------------
// Sample MDX content
// ---------------------------------------------------------------------------

const TODAY = new Date().toISOString().slice(0, 10)

const SAMPLES = [
  {
    title: '01 — Full-featured article (all components)',
    body: `---
title: Getting Started with CorrelAid
date: ${TODAY}
tags: [tutorial, data-science, community]
draft: false
---

# Getting Started with CorrelAid

Welcome to **CorrelAid** — a network of data scientists working for the common good.
Try the autocomplete: type \`<\` anywhere in the body.

<InfoBox type="info" title="Did you know?">

CorrelAid has completed over 40 volunteer data-for-good projects since 2015.

</InfoBox>

## Our Work

We partner with non-profit organisations to turn data into impact.

<GalleryIslandWrapper width="prose" columns={2}>
  Content inside the gallery wrapper.
</GalleryIslandWrapper>

## Get Involved

Ready to contribute your data skills?

<CallToAction href="https://correlaid.org/join" label="Join the Network" variant="primary" />

## Raw HTML mixed with markdown

Sometimes you need an escape hatch — drop in raw HTML directly.

<details>
  <summary>Click to expand a long explanation</summary>
  <p>
    This block is rendered as <strong>plain HTML</strong>.
    It supports <em>inline</em> tags, <a href="https://correlaid.org">links</a>,
    and even tables:
  </p>
  <table>
    <thead>
      <tr><th>Year</th><th>Projects</th></tr>
    </thead>
    <tbody>
      <tr><td>2023</td><td>12</td></tr>
      <tr><td>2024</td><td>18</td></tr>
    </tbody>
  </table>
</details>

A line break here →<br/>← was forced with an HTML \`<br/>\`.

> Block quotes still work alongside HTML.

<hr />

<aside style="border-left: 4px solid #888; padding-left: 12px;">
  Inline-styled <code>&lt;aside&gt;</code> with attributes the linter should ignore.
</aside>
`,
  },
  {
    title: '02 — Unknown component (manifest warning)',
    body: `---
title: Workshop Announcement
date: ${TODAY}
draft: true
---

# Upcoming Workshop

We are hosting a data-for-good workshop next month.

<ScheduleWidget date="${TODAY}" location="Berlin" />

The \`ScheduleWidget\` above is **not in the component manifest** — it should show
an orange warning squiggle. Hover it to see the message.

<InfoBox type="warning" title="Note">
Known components like \`InfoBox\` do not produce warnings.
</InfoBox>
`,
  },
  {
    title: '03 — Syntax error (linter error)',
    body: `---
title: Draft With Error
date: ${TODAY}
draft: true
---

# Draft Article

This file contains a deliberate MDX syntax error — an unclosed JSX expression.
The linter runs 750 ms after you stop typing and underlines the problem in red.

<InfoBox title={this expression is never closed
`,
  },
  {
    title: '04 — Plain markdown (no components)',
    body: `---
title: Simple Report
date: ${TODAY}
author: CorrelAid Team
---

# Q2 Data Report

A plain markdown document with no custom components. The frontmatter block
above should have a subtle background tint distinguishing it from the body.

## Summary

- 12 active projects
- 47 volunteers involved
- 3 publications submitted

> "Data is a tool for change, not just analysis."
`,
  },
]

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Build extension
  console.log('Building extension…')
  try {
    execSync('npm run build', { cwd: ROOT, stdio: 'pipe' })
    console.log('✓ Extension built')
  } catch (err) {
    console.error('✗ Build failed:\n', err.stdout?.toString() || err.message)
    process.exit(1)
  }

  // 2. Start Directus
  console.log('Starting Directus (docker compose up -d)…')
  const dc = spawnSync('docker', ['compose', 'up', '-d'], { cwd: ROOT, stdio: 'inherit' })
  if (dc.status !== 0) {
    console.error('✗ docker compose failed — is Docker running?')
    process.exit(1)
  }

  // 3. Start manifest server
  const server = startManifestServer()

  // 4. Wait for Directus
  console.log(`Waiting for Directus at ${BASE}…`)
  await waitForDirectus()
  console.log('✓ Directus is ready')

  // 5. Authenticate
  const { data: { access_token } } = await api('/auth/login', 'POST', { email: EMAIL, password: PASSWORD })
  console.log('✓ Authenticated')

  // --reset: delete the preview collection so everything is rebuilt from scratch
  if (process.argv.includes('--reset')) {
    console.log(`Resetting collection "${COLLECTION}"…`)
    try {
      await api(`/collections/${COLLECTION}`, 'DELETE', undefined, access_token)
      console.log(`✓ Deleted "${COLLECTION}"`)
    } catch (err) {
      if (err.status !== 404) throw err
      console.log(`  "${COLLECTION}" did not exist`)
    }
  }

  // 6. Create collection with ALL fields in one request.
  //    In Directus 11, post-hoc field creation via /fields requires schema
  //    permissions that even admin_access users may not have on user-created
  //    collections. Bundling everything into the initial collection creation
  //    payload uses the same permitted code path as the schema setup wizard.
  const collectionCreated = await createOrSkip(`Collection "${COLLECTION}" with fields`, () =>
    api('/collections', 'POST', {
      collection: COLLECTION,
      schema: {},
      meta: { icon: 'article', note: 'Preview collection for the MDX body editor extension' },
      fields: [
        {
          field: 'id',
          type: 'integer',
          meta: { hidden: true, readonly: true },
          schema: { is_primary_key: true, has_auto_increment: true },
        },
        {
          field: 'title',
          type: 'string',
          meta: { interface: 'input', display: 'raw', required: true },
          schema: { is_nullable: false },
        },
        {
          field: 'body',
          type: 'text',
          meta: {
            interface: 'mdx-body-editor',
            note: 'Full MDX file — frontmatter + body',
            options: { manifestUrl: MANIFEST_URL },
          },
        },
      ],
    }, access_token),
  )

  // Grant the admin role item-level CRUD on the collection.
  // In Directus 11, admin_access covers schema/system operations but not
  // data (items) CRUD on user-created collections.
  if (collectionCreated !== null) {
    await grantAdminCrud(COLLECTION, access_token)
  }

  // Try to sync the manifest URL on subsequent runs (port may have changed).
  // Not fatal — Directus 11 may block schema PATCHes for the admin role.
  try {
    await api(`/fields/${COLLECTION}/body`, 'PATCH', {
      meta: { options: { manifestUrl: MANIFEST_URL } },
    }, access_token)
    console.log(`  manifestUrl → ${MANIFEST_URL}`)
  } catch {
    console.log(`  (Could not update manifestUrl — set it manually in Settings → Data Model → ${COLLECTION} → body → Options)`)
  }

  // 8. Seed items
  const createdIds = []

  if (collectionCreated !== null) {
    // Fresh collection — seed unconditionally, no need to query item count
    console.log('Seeding sample items…')
    for (const sample of SAMPLES) {
      const { data: item } = await api(`/items/${COLLECTION}`, 'POST', {
        title: sample.title,
        body: sample.body,
      }, access_token)
      createdIds.push(item.id)
      console.log(`  ✓ Item ${item.id}: ${sample.title}`)
    }
  } else {
    // Collection existed — try to list existing IDs for the URL summary.
    // Catch FORBIDDEN in case policies haven't propagated (non-fatal).
    console.log(`  Collection already existed — skipping seed`)
    try {
      const { data: rows } = await api(
        `/items/${COLLECTION}?fields=id&limit=10&sort=id`,
        'GET', undefined, access_token,
      )
      rows.forEach(r => createdIds.push(r.id))
    } catch (err) {
      if (err.code === 'FORBIDDEN') {
        console.log('  (Could not list items — open the collection in the admin UI)')
      } else {
        throw err
      }
    }
  }

  // 9. Print URLs
  console.log()
  console.log('─────────────────────────────────────────────')
  console.log('  Local preview ready')
  console.log('─────────────────────────────────────────────')
  console.log(`  Directus admin  ${BASE}/admin`)
  console.log(`  Collection list ${BASE}/admin/content/${COLLECTION}`)
  console.log()
  createdIds.forEach((id, i) => {
    const label = SAMPLES[i]?.title ?? `Item ${id}`
    console.log(`  ${BASE}/admin/content/${COLLECTION}/${id}`)
    console.log(`    ${label}`)
  })
  console.log()
  console.log(`  Manifest server ${MANIFEST_URL}`)
  console.log()
  console.log('  Press Ctrl+C to stop the manifest server.')
  console.log('  Directus keeps running — stop it with: docker compose down')
  console.log('─────────────────────────────────────────────')

  // Keep the manifest server alive until the user kills the process
  process.on('SIGINT', () => {
    console.log('\nStopping manifest server…')
    server.close(() => process.exit(0))
  })
}

main().catch(err => {
  console.error('\n✗', err.message)
  if (err.body) console.error('  Directus response:', JSON.stringify(err.body, null, 2))
  process.exit(1)
})
