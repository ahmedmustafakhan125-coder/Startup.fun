import { describe, expect, it } from 'vitest'
import { isDomain, isInternalAddress, parseGithub } from '../src/checks.ts'

describe('domain check guards', () => {
  it('accepts domain names only', () => {
    expect(isDomain('acme.com')).toBe(true)
    for (const bad of ['localhost', '127.0.0.1', 'acme.com/path', 'acme.com:8080', 'http://acme.com', '']) expect(isDomain(bad), bad).toBe(false)
  })

  it('never lets the HTTPS request reach this machine or a private network', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.17.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1']) expect(isInternalAddress(ip, 4), ip).toBe(true)
    for (const ip of ['::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) expect(isInternalAddress(ip, 6), ip).toBe(true)
    expect(isInternalAddress('93.184.216.34', 4)).toBe(false)
    expect(isInternalAddress('2606:2800:220:1:248:1893:25c8:1946', 6)).toBe(false)
  })
})

describe('parseGithub', () => {
  it('reads handles and URLs, and rejects anything that could change the API path', () => {
    expect(parseGithub('acme/app')).toEqual({ owner: 'acme', repo: 'app' })
    expect(parseGithub('https://github.com/acme/app.git')).toEqual({ owner: 'acme', repo: 'app' })
    expect(parseGithub('acme')).toEqual({ owner: 'acme', repo: undefined })
    expect(parseGithub('acme/app?x=1')).toBeNull()
    expect(parseGithub('../user')).toBeNull()
  })
})
