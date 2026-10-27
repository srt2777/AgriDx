export interface GatewayIdentity { gatewayVersion?: string; schemaVersion?: number; capabilities?: Record<string, boolean>; gatewaySourceHash?: string | null }
export function gatewayMeetsRequirements(gateway: GatewayIdentity | null | undefined, requirements: { minimumSchema: number; capabilities: string[] }): boolean {
  return Boolean(gateway && Number.isSafeInteger(gateway.schemaVersion) && Number(gateway.schemaVersion) >= requirements.minimumSchema &&
    gateway.capabilities && requirements.capabilities.every(capability => gateway.capabilities?.[capability] === true));
}
export function gatewayHashStatus(gateway: GatewayIdentity | null | undefined, expected: string): 'match' | 'mismatch' | 'unknown' {
  if (!gateway?.gatewaySourceHash || !/^[a-f0-9]{64}$/.test(gateway.gatewaySourceHash) || !/^[a-f0-9]{64}$/.test(expected)) return 'unknown';
  return gateway.gatewaySourceHash === expected ? 'match' : 'mismatch';
}
