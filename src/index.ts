import { defineInterface } from '@directus/extensions-sdk'
import InterfaceComponent from './interface.vue'

export default defineInterface({
  id: 'mdx-body-editor',
  name: 'MDX Body Editor',
  icon: 'code',
  description: 'Full-file MDX editor with component autocomplete',
  component: InterfaceComponent,
  types: ['text'],
  options: [
    {
      field: 'manifestUrl',
      name: 'Component Manifest URL',
      type: 'string',
      meta: {
        interface: 'input',
        note: 'URL to a JSON manifest of available MDX components (e.g. https://example.com/components-manifest.json)',
      },
    },
  ],
})
