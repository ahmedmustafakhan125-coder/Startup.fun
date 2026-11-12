// Generates the TypeScript client in src/generated from the Anchor IDL (Codama).
// Run `npm run generate` after `anchor build`; the IDL copy in idl/ is committed for checkouts without a build.
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor'
import { renderVisitor } from '@codama/renderers-js'
import { createFromRoot } from 'codama'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'

const built = new URL('../target/idl/obverse.json', import.meta.url)
const committed = new URL('./idl/obverse.json', import.meta.url)
if (existsSync(built)) copyFileSync(built, committed)

const codama = createFromRoot(rootNodeFromAnchor(JSON.parse(readFileSync(committed, 'utf8'))))
await codama.accept(
  renderVisitor(new URL('./src/generated', import.meta.url).pathname, {
    deleteFolderBeforeRendering: true,
    generatedFolder: '.',
    syncPackageJson: false,
  }),
)
