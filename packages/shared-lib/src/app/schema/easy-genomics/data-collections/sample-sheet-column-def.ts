import { z } from 'zod';

export const SampleSheetColumnRoleSchema = z.enum([
  'sample_id',
  'read1',
  'read2',
  'reads',
  'reference_fasta',
  'reference_gtf',
  'reference_gff',
  'reference_bed',
  'input_bam',
  'input_cram',
  'input_vcf',
  'assembly_fasta',
  'metadata',
  'custom_uri',
]);

export const SampleSheetColumnDefSchema = z
  .object({
    columnName: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_]*$/,
        'Column name must start with a letter and contain only letters, digits, and underscores',
      ),
    role: SampleSheetColumnRoleSchema,
    required: z.boolean(),
  })
  .strict();
