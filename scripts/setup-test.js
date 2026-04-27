#!/usr/bin/env node
// Sets up a test collection in Directus with the mdx-body-editor interface.
// Run after `docker compose up` and `npm run build`.
//
// Usage:
//   node scripts/setup-test.js
//   DIRECTUS_URL=http://localhost:8055 ADMIN_PASSWORD=secret node scripts/setup-test.js

const BASE = process.env.DIRECTUS_URL ?? 'http://localhost:8055'
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin'
const COLLECTION = 'test_mdx_articles'

async function api(path, method = 'GET', body = undefined, token = undefined) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json()
  if (!res.ok) throw Object.assign(new Error(json.errors?.[0]?.message ?? res.statusText), { status: res.status, body: json })
  return json
}

async function waitForDirectus(retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      await fetch(`${BASE}/server/health`)
      return
    } catch {
      if (i === retries - 1) throw new Error(`Directus at ${BASE} not reachable after ${retries} attempts`)
      console.log(`Waiting for Directus… (${i + 1}/${retries})`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

async function main() {
  await waitForDirectus()

  const { data: { access_token } } = await api('/auth/login', 'POST', { email: EMAIL, password: PASSWORD })
  console.log('✓ Authenticated')

  // Create collection (idempotent — skip if it already exists)
  try {
    await api('/collections', 'POST', {
      collection: COLLECTION,
      meta: { icon: 'article', note: 'Test collection for MDX body editor' },
      fields: [
        {
          field: 'id',
          type: 'integer',
          meta: { hidden: true, readonly: true },
          schema: { is_primary_key: true, has_auto_increment: true },
        },
      ],
    }, access_token)
    console.log(`✓ Created collection "${COLLECTION}"`)
  } catch (err) {
    if (err.status === 400 && err.body?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
      console.log(`  Collection "${COLLECTION}" already exists, skipping`)
    } else {
      throw err
    }
  }

  // Create the MDX body field (idempotent)
  try {
    await api(`/fields/${COLLECTION}`, 'POST', {
      field: 'body',
      type: 'text',
      meta: {
        interface: 'mdx-body-editor',
        note: 'Full MDX file content (frontmatter + body)',
        options: {
          manifestUrl: '',
        },
      },
    }, access_token)
    console.log('✓ Created field "body" with mdx-body-editor interface')
  } catch (err) {
    if (err.status === 400 && err.body?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
      console.log('  Field "body" already exists, skipping')
    } else {
      throw err
    }
  }

  // Create a sample item with frontmatter + body
  const { data: item } = await api(`/items/${COLLECTION}`, 'POST', {
    body: `---
title: Test Article
date: ${new Date().toISOString().slice(0, 10)}
draft: true
---

# Hello MDX

This is a test article. Try typing \`<\` to trigger component autocomplete.
`,
  }, access_token)
  console.log(`✓ Created sample item (id: ${item.id})`)

  console.log()
  console.log(`Open in Directus:`)
  console.log(`  ${BASE}/admin/content/${COLLECTION}/${item.id}`)
}

main().catch((err) => {
  console.error('✗', err.message)
  if (err.body) console.error('  API response:', JSON.stringify(err.body, null, 2))
  process.exit(1)
})
