#!/usr/bin/env node
/**
 * scripts/preview-correlaid.js — Preview using https://correlaid.org/components-manifest.json.
 *
 * Like preview.js but skips the local manifest server — the field points
 * directly at the live CorrelAid manifest so autocomplete and linting reflect
 * the real component set.
 *
 * Usage:
 *   node scripts/preview-correlaid.js
 *   node scripts/preview-correlaid.js --reset
 *   ADMIN_PASSWORD=secret node scripts/preview-correlaid.js
 */

const { execSync, spawnSync } = require('node:child_process')
const { join } = require('node:path')

const ROOT         = join(__dirname, '..')
const BASE         = process.env.DIRECTUS_URL   ?? 'http://localhost:8055'
const EMAIL        = process.env.ADMIN_EMAIL    ?? 'admin@example.com'
const PASSWORD     = process.env.ADMIN_PASSWORD ?? 'admin'
const MANIFEST_URL = 'https://correlaid.org/components-manifest.json'
const COLLECTION   = 'mdx_preview_correlaid'

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

async function grantAdminCrud(collection, token) {
  const { data: me } = await api('/users/me?fields=role', 'GET', undefined, token)
  const roleId = me.role
  if (!roleId) return

  for (const action of ['create', 'read', 'update', 'delete']) {
    try {
      await api('/permissions', 'POST', {
        role: roleId, collection, action, fields: ['*'], permissions: {}, validation: {},
      }, token)
    } catch { /* already exists or admin bypasses */ }
  }
  console.log(`✓ Admin CRUD permissions set on "${collection}"`)
}

// ---------------------------------------------------------------------------
// Sample MDX content — uses real components from the CorrelAid manifest
// ---------------------------------------------------------------------------

const TODAY = new Date().toISOString().slice(0, 10)

const SAMPLES = [
  {
    title: '01 — InfoBox + Button (common pattern)',
    body: `---
title: Join CorrelAid
date: ${TODAY}
tags: [community, volunteering]
draft: false
---

# Join CorrelAid

CorrelAid is a volunteer network of data scientists working for the common good.

<InfoBox title="Ready to make an impact?" buttonLabel="Apply now" buttonHref="https://correlaid.org/join" buttonVariant="primary" backgroundColor="blue">

We match skilled volunteers with non-profit organisations that need data expertise.
No prior experience in the social sector required.

</InfoBox>

## How it works

1. Apply via the form
2. Get matched to a project
3. Work remotely with your team

<Button href="https://correlaid.org/projects" label="Browse open projects" variant="secondary" />
`,
  },
  {
    title: '02 — Blockquote + DirectusImage',
    body: `---
title: Our Mission
date: ${TODAY}
draft: false
---

# Our Mission

We believe data literacy is a public good.

<Blockquote content="Data is a tool for change — not just analysis." />

<DirectusImage alt="CorrelAid team at a workshop" credit="CorrelAid e.V." />

## Impact in numbers

Since 2015 we have run over 40 data-for-good projects across Europe.
`,
  },
  {
    title: '03 — GalleryIslandWrapper + EventsGallery',
    body: `---
title: What's On
date: ${TODAY}
draft: false
---

# Upcoming Events

<EventsGallery n={3} title="Upcoming workshops & meetups" lang="en" />

## Recent Blog Posts

<GalleryIslandWrapper galleryType="blog" n={4} width="full" title="From the community" />
`,
  },
  {
    title: '04 — PeopleGallery + OverviewIslandWrapper',
    body: `---
title: The Team
date: ${TODAY}
draft: false
---

# Board

<PeopleGallery type="board" width="full" />

# Ethics Commission

<PeopleGallery type="ethics_commission" hideTitle={true} />

# All Projects

<OverviewIslandWrapper overviewType="projects" pageSize={12} />
`,
  },
  {
    title: '05 — Unknown component (linter warning)',
    body: `---
title: Draft With Unknown Component
date: ${TODAY}
draft: true
---

# Draft Article

The component below is **not in the manifest** — it should show an orange warning squiggle.

<ScheduleWidget date="${TODAY}" location="Berlin" />

Known components like \`InfoBox\` work fine:

<InfoBox title="This one is valid" />
`,
  },
  {
    title: '06 — Syntax error (linter error)',
    body: `---
title: Draft With Syntax Error
date: ${TODAY}
draft: true
---

# Broken Draft

This file contains a deliberate MDX syntax error — an unclosed JSX expression.
The linter underlines the problem in red ~750 ms after you stop typing.

<InfoBox title={this expression is never closed
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

  // 3. Wait for Directus
  console.log(`Waiting for Directus at ${BASE}…`)
  await waitForDirectus()
  console.log('✓ Directus is ready')

  // 4. Authenticate
  const { data: { access_token } } = await api('/auth/login', 'POST', { email: EMAIL, password: PASSWORD })
  console.log('✓ Authenticated')

  // --reset: delete all items so the seed runs fresh.
  // Schema-level collection deletion is blocked by Directus 11 policies even
  // for admin-role users via the REST API, so we clear items instead.
  if (process.argv.includes('--reset')) {
    console.log(`Resetting items in "${COLLECTION}"…`)
    try {
      const { data: rows } = await api(
        `/items/${COLLECTION}?fields=id&limit=-1`,
        'GET', undefined, access_token,
      )
      if (rows.length > 0) {
        await api(`/items/${COLLECTION}`, 'DELETE', rows.map(r => r.id), access_token)
        console.log(`✓ Deleted ${rows.length} item(s) from "${COLLECTION}"`)
      } else {
        console.log(`  "${COLLECTION}" had no items`)
      }
    } catch (err) {
      if (err.status === 404 || err.code === 'FORBIDDEN') {
        console.log(`  "${COLLECTION}" did not exist or was not accessible — will create fresh`)
      } else {
        throw err
      }
    }
  }

  // 5. Create collection + fields
  const collectionCreated = await createOrSkip(`Collection "${COLLECTION}" with fields`, () =>
    api('/collections', 'POST', {
      collection: COLLECTION,
      schema: {},
      meta: { icon: 'article', note: 'CorrelAid component preview for the MDX body editor extension' },
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

  if (collectionCreated !== null) {
    await grantAdminCrud(COLLECTION, access_token)
  }

  // Sync manifest URL on subsequent runs
  try {
    await api(`/fields/${COLLECTION}/body`, 'PATCH', {
      meta: { options: { manifestUrl: MANIFEST_URL } },
    }, access_token)
    console.log(`  manifestUrl → ${MANIFEST_URL}`)
  } catch {
    console.log(`  (Could not update manifestUrl — set it manually in Settings → Data Model → ${COLLECTION} → body → Options)`)
  }

  // 6. Seed items
  const createdIds = []
  const shouldSeed = collectionCreated !== null || process.argv.includes('--reset')

  if (shouldSeed) {
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
    console.log('  Collection already existed — skipping seed')
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

  // 7. Print URLs
  console.log()
  console.log('─────────────────────────────────────────────')
  console.log('  CorrelAid preview ready')
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
  console.log(`  Manifest        ${MANIFEST_URL}`)
  console.log()
  console.log('  Directus keeps running — stop it with: docker compose down')
  console.log('─────────────────────────────────────────────')
}

main().catch(err => {
  console.error('\n✗', err.message)
  if (err.body) console.error('  Directus response:', JSON.stringify(err.body, null, 2))
  process.exit(1)
})
