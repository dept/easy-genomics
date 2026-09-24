import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';

/**
 * Cheap presence check — no network call. Returns a reason string when the
 * laboratory cannot run an LLM classification for this platform, or null when
 * the stored config is at least complete. Liveness is validated separately,
 * when the config is saved.
 */
export function assertLaboratoryLlmConfigured(
  laboratory: Laboratory,
  platform: LaboratoryRun['Platform'],
): string | null {
  const provider = platform === 'AWS HealthOmics' ? laboratory.HealthOmicsLlmProvider : laboratory.SeqeraLlmProvider;
  const modelId = platform === 'AWS HealthOmics' ? laboratory.HealthOmicsLlmModelId : laboratory.SeqeraLlmModelId;

  if (!provider) return 'No LLM provider is configured for this laboratory';
  if (!modelId) return 'No LLM model ID is configured for this laboratory';
  return null;
}
