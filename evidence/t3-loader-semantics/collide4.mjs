// PROBE D — two mounted agent-teams instances collide on global tool names.
// Reads the store DSH packages directly (no repo dependency). Run:
//   node collide4.mjs
import { Context } from '/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import SystemPrompt from '/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'
import Tools from '/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(Tools)
await new Promise((resolve) => setTimeout(resolve, 50))
if (ctx.get('tools') === undefined) {
  console.error('probe invalid: tools service did not mount')
  process.exit(2)
}

// Shape of a real agent-teams tool definition: name + output{schema,render}.
const definition = (label) => ({
  name: 'agent_teams_create',
  description: label,
  parameters: { type: 'object', properties: {} },
  output: { schema: { type: 'string' }, render: () => label },
  execute: async () => label,
})

let failed = false
for (const label of ['instance-A', 'instance-B']) {
  try {
    ctx.tools.register(definition(label))
    console.log(`${label}: registered OK`)
  } catch (error) {
    failed = true
    console.log(`${label}: THREW ${error.name}: ${error.message}`)
  }
}
process.exit(failed ? 0 : 1)
