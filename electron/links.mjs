export const SOURCE_URL = 'https://github.com/furey/noise-8bit'

const EXTERNAL_HOSTS = new Set(['noise-8bit.furey.dev', 'github.com', 'about.me'])

export const isExternalLink = url => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && EXTERNAL_HOSTS.has(parsed.host) && !parsed.username && !parsed.password
  } catch {
    return false
  }
}
