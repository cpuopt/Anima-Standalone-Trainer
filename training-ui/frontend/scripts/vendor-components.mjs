// Optional refresh tool. Components are committed; builds never fetch remote UI source.
import fs from 'node:fs'
import path from 'node:path'
for (const name of ['button', 'input']) {
  const response = await fetch(`https://www.shadcn-vue.com/r/styles/new-york-v4/${name}.json`)
  if (!response.ok) throw Error(`Registry returned ${response.status}`)
  const item = await response.json()
  for (const file of item.files) {
    const target = path.join('src/components/ui', name, path.basename(file.path))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, file.content.replaceAll('from "cn"', 'from "@/lib/utils"'))
  }
  console.log(`Added official shadcn-vue ${name}`)
}
