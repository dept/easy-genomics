export interface SampleSheetValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a CSV sample sheet file before uploading.
 *
 * Checks:
 * - File is present and non-empty
 * - File contents are readable
 * - A header row exists (first non-empty line)
 */
export async function validateSampleSheetFile(file: File | null | undefined): Promise<SampleSheetValidationResult> {
  // Basic presence & size check
  if (!file) {
    return {
      valid: false,
      error: 'No file selected. Choose a CSV sample sheet to upload.',
    };
  }

  if (file.size === 0) {
    return {
      valid: false,
      error: 'The sample sheet file is empty. Add a header row and upload it again.',
    };
  }

  let contents: string;
  try {
    contents = await file.text();
  } catch {
    return {
      valid: false,
      error: 'The sample sheet file could not be read. Please check that it is a valid CSV file and try again.',
    };
  }

  if (!contents.trim()) {
    return {
      valid: false,
      error: 'The sample sheet file has no content. Add a header row and upload it again.',
    };
  }

  // Use the first non-empty line as the header row
  const lines = contents.split(/\r?\n/).map((line) => line.trim());
  const headerLine = lines.find((line) => line.length > 0);

  if (!headerLine) {
    return {
      valid: false,
      error: 'The sample sheet is missing a header row. Add a first line with column names.',
    };
  }

  return { valid: true };
}
