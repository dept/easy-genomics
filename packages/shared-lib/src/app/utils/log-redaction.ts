/**
 * Redacts personally identifiable information and secrets from raw run logs
 * before they are sent to an external LLM for failure analysis.
 *
 * Genomics run logs can contain patient/sample identifiers, S3 paths, emails,
 * ARNs (which embed the AWS account id), IP addresses, and credentials. The
 * client's hard requirement is that NONE of this leaves the platform. Each rule
 * below is intentionally conservative: when a pattern is ambiguous we prefer to
 * over-redact (lose some diagnostic text) rather than risk leaking sensitive
 * data. Diagnostic signal lives in the error wording ("exit status 1", "missing
 * required column", "OutOfMemoryError"), not in IDs or paths, so aggressive
 * redaction keeps the part the LLM actually needs.
 *
 * Order matters: more specific patterns run before generic ones so, for example,
 * a JWT is masked as a token rather than partially matched by the long-hex rule.
 */

interface RedactionRule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}

const REDACTION_RULES: readonly RedactionRule[] = [
  // JSON Web Tokens (header.payload.signature) — e.g. Seqera / OIDC bearer tokens.
  {
    name: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: '[REDACTED_JWT]',
  },
  // "Bearer <token>" / "token=<token>" / "apikey: <token>" style credentials.
  {
    name: 'bearer-token',
    pattern: /\b(bearer|token|api[_-]?key|secret|password|passwd|pwd)\b\s*[:=]?\s*["']?[A-Za-z0-9._\-+/]{8,}["']?/gi,
    replacement: '$1 [REDACTED_TOKEN]',
  },
  // AWS access key ids (AKIA/ASIA/AROA/AIDA + 16 chars).
  {
    name: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_AWS_KEY]',
  },
  // Email addresses.
  {
    name: 'email',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: '[REDACTED_EMAIL]',
  },
  // S3 URIs (bucket + key can both embed patient/sample identifiers).
  {
    name: 's3-uri',
    pattern: /s3:\/\/[^\s'"]+/gi,
    replacement: '[REDACTED_S3_URI]',
  },
  // AWS ARNs (embed account id and resource names).
  {
    name: 'arn',
    pattern: /arn:aws[a-z-]*:[^\s'"]+/gi,
    replacement: '[REDACTED_ARN]',
  },
  // Illumina-style sample / FASTQ identifiers, e.g. GOLZ2051A70614_S168_L002_R1_001.
  // The `_S<n>_L<lane>` segment is the reliable Illumina marker; mask the whole token.
  {
    name: 'sample-id',
    pattern: /\b\S*_S\d+_L\d{3}\S*/g,
    replacement: '[REDACTED_SAMPLE_ID]',
  },
  // FASTQ filenames not caught by the Illumina pattern above.
  {
    name: 'fastq-file',
    pattern: /\b[\w.-]+\.f(?:ast)?q(?:\.gz)?\b/gi,
    replacement: '[REDACTED_FASTQ_FILE]',
  },
  // IPv4 addresses.
  {
    name: 'ipv4',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[REDACTED_IP]',
  },
  // UUIDs (run/lab/org identifiers).
  {
    name: 'uuid',
    pattern: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    replacement: '[REDACTED_UUID]',
  },
  // 12-digit AWS account ids appearing standalone (not already inside an ARN).
  {
    name: 'account-id',
    pattern: /\b\d{12}\b/g,
    replacement: '[REDACTED_ACCOUNT_ID]',
  },
  // Long hex blobs (hashes, secret material).
  {
    name: 'long-hex',
    pattern: /\b[0-9a-fA-F]{32,}\b/g,
    replacement: '[REDACTED_HEX]',
  },
];

/**
 * Apply every redaction rule, in order, to the given text. Safe to call on an
 * empty / undefined value (returns an empty string).
 */
export function redactSensitive(text: string | undefined | null): string {
  if (!text) return '';
  let result = text;
  for (const rule of REDACTION_RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}
