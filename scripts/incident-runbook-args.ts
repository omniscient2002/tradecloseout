/**
 * Fail-closed input contract for security incident runbooks.
 * Incident execution needs an explicitly authorized operator credential and
 * separately recorded approval; it must never fall back to a migrator URL.
 */
export type IncidentRunbookCode = 'RB-08' | 'RB-09' | 'RB-12';
export interface IncidentRunbookArgs {
  code: IncidentRunbookCode;
  orgId: string;
  entityId: string | null;
  reason: string;
  execute: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseIncidentRunbookArgs(args: string[]): IncidentRunbookArgs {
  const flags = args.filter((value) => value.startsWith('--'));
  if (flags.length !== 1 || (flags[0] !== '--dry-run' && flags[0] !== '--execute')) {
    throw new Error('Specify exactly one of --dry-run or --execute.');
  }
  const positional = args.filter((value) => !value.startsWith('--'));
  if (positional.length !== 4) {
    throw new Error('Usage: RB-08|RB-09|RB-12 <org-uuid> <entity-uuid|-> "<reason>" --dry-run|--execute');
  }
  const [code, orgId, entityId, rawReason] = positional;
  if (code !== 'RB-08' && code !== 'RB-09' && code !== 'RB-12') {
    throw new Error('Unsupported incident runbook.');
  }
  if (!UUID.test(orgId)) throw new Error('An exact organisation UUID is required.');
  if (code === 'RB-08' ? entityId !== '-' : !UUID.test(entityId)) {
    throw new Error('A valid target version/package UUID is required (or - for RB-08).');
  }
  const reason = rawReason.trim();
  if (reason.length < 12 || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason)) {
    throw new Error('An explicit, printable incident reason of 12–500 characters is required.');
  }
  return {
    code, orgId: orgId.toLowerCase(), entityId: entityId === '-' ? null : entityId.toLowerCase(),
    reason, execute: flags[0] === '--execute',
  };
}
