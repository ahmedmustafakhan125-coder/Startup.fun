import { afterAll, describe, expect, it } from 'vitest'
import type { HealthResponse } from '../src/app.ts'
import { loadEnv } from '../src/env.ts'
import { testApp } from './helpers.ts'

describe('GET /health', async () => {
  const { app } = await testApp()
  afterAll(() => app.close())

  it('reports ok with a reachable database', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json<HealthResponse>()
    expect(body.status).toBe('ok')
    expect(body.db).toBe('ok')
    expect(body.network).toBe('devnet')
  })
})

describe('loadEnv', () => {
  it('defaults to devnet', () => {
    expect(loadEnv({}).rpcUrl).toContain('devnet')
  })

  it('refuses a mainnet RPC URL', () => {
    expect(() => loadEnv({ RPC_URL: 'https://api.mainnet-beta.solana.com' })).toThrow(/devnet only/)
  })
})
