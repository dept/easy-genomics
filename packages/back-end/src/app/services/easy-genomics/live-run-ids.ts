/**
 * Run ids that still have a row. `null` means the run table could not be read: callers must
 * treat every usage as still live.
 */
export async function liveRunIdsForLaboratory(laboratoryId: string): Promise<Set<string> | null> {
  try {
    // Imported here so the tagging service and the run service do not load each other at startup.
    const { LaboratoryRunService } = await import('./laboratory-run-service');
    const runs = await new LaboratoryRunService().listAllRunsForLaboratory(laboratoryId);
    return new Set(runs.map((run) => run.RunId).filter((id): id is string => !!id));
  } catch (err) {
    console.warn(`Could not load runs for lab ${laboratoryId}; treating file usages as live:`, err);
    return null;
  }
}

/** Drops usages whose run row is gone. A `null` live set keeps every usage. */
export function usagesStillLive<T>(
  usages: Record<string, T> | undefined,
  liveRunIds: Set<string> | null,
): Record<string, T> | undefined {
  if (!usages) return undefined;
  if (liveRunIds == null) return Object.keys(usages).length ? usages : undefined;
  const live: Record<string, T> = {};
  for (const [runId, summary] of Object.entries(usages)) {
    if (liveRunIds.has(runId)) live[runId] = summary;
  }
  return Object.keys(live).length ? live : undefined;
}
