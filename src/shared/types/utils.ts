export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

export function generateWorktreeBranchName(
  provider: 'github' | 'gitlab' | 'local' | 'auto',
  numberOrId: string | number | null,
  title: string,
  prefix: string = 'flowpatch/'
): string {
  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`

  const idPart = numberOrId ? String(numberOrId) : 'local'

  const slug = slugify(title)

  const fullName = `${normalizedPrefix}${provider}-${idPart}-${slug}`

  if (fullName.length > 100) {
    const prefixAndId = `${normalizedPrefix}${provider}-${idPart}-`
    const maxSlugLen = 100 - prefixAndId.length
    return `${prefixAndId}${slug.slice(0, Math.max(maxSlugLen, 10))}`
  }

  return fullName
}
