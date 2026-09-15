const STATUS_PHRASES: Record<string, string> = {
  COMPLETED: 'completed successfully',
  SUCCEEDED: 'completed successfully',
  FAILED: 'failed',
  CANCELLED: 'was cancelled',
  ABORTED: 'was aborted',
  DELETED: 'was deleted',
};

export function formatRunStatusPhrase(status: string): string {
  const normalized = status.toUpperCase();
  return STATUS_PHRASES[normalized] || `is ${normalized}`;
}
