/**
 * Identifies the easy-genomics *domain* nested stack that the stack-split
 * migration detaches from `*-main-back-end-stack`.
 *
 * Auth / AWS HealthOmics / NF-Tower nested stacks correctly remain on that
 * parent after migration. When `envName` is literally `easygenomics`, their
 * CDK logical IDs look like `easygenomicsauthnestedstack…` and their physical
 * ARNs embed `…-easygenomics-main-back-end-stack-…`, so a bare
 * `/easy[-]?genomics/` match false-positives and permanently blocks deploy.
 */

const SIBLING_NESTED_STACK = /(?:auth|awshealthomics|healthomics|nftower)nested(?:stack)?/i;

/** Domain nested stack: `easy-genomics-nested-stack` or `${env}-easy-genomics-nested-stack`. */
const DOMAIN_NESTED_STACK = /easygenomics(?:easygenomics)?nested(?:stack)?/i;

function normalizeStackIdentity(value: string): string {
  return value.toLowerCase().replace(/-/g, '');
}

/**
 * Returns true when either the logical id or physical id refers to the
 * easy-genomics domain nested stack (not Auth / HealthOmics / NF-Tower).
 */
export function isEasyGenomicsDomainNestedStack(
  logicalId: string | undefined,
  physicalId: string | undefined,
): boolean {
  for (const candidate of [logicalId, physicalId]) {
    if (!candidate) {
      continue;
    }
    const normalized = normalizeStackIdentity(candidate);
    if (SIBLING_NESTED_STACK.test(normalized)) {
      continue;
    }
    if (DOMAIN_NESTED_STACK.test(normalized)) {
      return true;
    }
  }
  return false;
}
