export interface Sample { path: string; name: string; mtime: number }
export interface Order { path: string; group: string }
export interface Group { key: string; images: Sample[] }
export function groupSamples(images: Sample[], order: Order[] = []): Group[] {
  const saved = new Map(order.map((item, index) => [item.path, { ...item, index }]))
  const groups = new Map<string, Sample[]>()
  for (const image of images) {
    const key = saved.get(image.path)?.group ?? image.name.match(/_(\d{2,})_\d{14}/)?.[1] ?? 'default'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(image)
  }
  return [...groups].sort(([a], [b]) => a === 'default' ? 1 : b === 'default' ? -1 : Number(a) - Number(b)).map(([key, members]) => ({ key, images: members.sort((a, b) => {
    const x = saved.get(a.path), y = saved.get(b.path)
    return x && y ? x.index - y.index : x ? 1 : y ? -1 : b.mtime - a.mtime
  }) }))
}
export function moveSamples(groups: Group[], paths: string[], targetGroup: string, targetPath?: string, after = false): Group[] {
  if (targetPath && paths.includes(targetPath)) return groups
  const moving = groups.flatMap(g => g.images).filter(image => paths.includes(image.path))
  if (!moving.length || !groups.some(g => g.key === targetGroup)) return groups
  return groups.map(group => {
    const images = group.images.filter(image => !paths.includes(image.path))
    if (group.key === targetGroup) {
      const index = targetPath ? images.findIndex(image => image.path === targetPath) : -1
      images.splice(index < 0 ? images.length : index + Number(after), 0, ...moving)
    }
    return { key: group.key, images }
  })
}
export function rangePaths(images: Sample[], anchor: string | null, path: string): string[] {
  const a = images.findIndex(image => image.path === anchor), b = images.findIndex(image => image.path === path)
  return a < 0 || b < 0 ? [path] : images.slice(Math.min(a,b), Math.max(a,b)+1).map(image => image.path)
}
