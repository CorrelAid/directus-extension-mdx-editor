import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // @mdx-js/mdx and its dependencies are ESM-only; tell vitest not to
    // try to CJS-transform them.
    server: {
      deps: {
        inline: [/^(?!@mdx-js)/],
      },
    },
  },
})
