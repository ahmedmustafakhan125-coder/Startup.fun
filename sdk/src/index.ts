// Shared types for app/ and server/. The generated program client is added in Phase 4
// under src/generated/ (see PHASES.md) and re-exported from here.

/** The only cluster this project targets. */
export const CLUSTER = 'devnet' as const
export type Cluster = typeof CLUSTER

/** Lifecycle of a startup, matching app/src/store/types.ts. */
export type StartupPhase = 'raising' | 'live' | 'wound_down'

/** Heartbeat state reported on-chain by the operator. */
export type Heartbeat = 'green' | 'red'
