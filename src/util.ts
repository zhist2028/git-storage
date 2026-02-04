import crypto from 'crypto'

export function hashKeyToBucket(key: string): string {
  const hash = crypto.createHash('sha1').update(key).digest('hex')
  return hash.slice(0, 2)
}

export function ensureNumber(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback
}

export function toBase64(value: Uint8Array | Buffer): string {
  return Buffer.from(value).toString('base64')
}

export function fromBase64(value: string): Buffer {
  return Buffer.from(value, 'base64')
}

export function patternToRegex(pattern?: string): RegExp {
  if (!pattern || pattern === '*') return /^.*$/
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const regex = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  return new RegExp(regex)
}
