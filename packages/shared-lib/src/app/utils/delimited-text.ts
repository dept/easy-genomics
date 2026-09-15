/** Picks '\t' for a .tsv filename (case-insensitive), ',' otherwise. */
export function delimiterForFilename(filename: string): string {
  return filename.toLowerCase().endsWith('.tsv') ? '\t' : ',';
}

/**
 * Minimal RFC-4180-style parser for delimited text (CSV/TSV). Handles quoted
 * fields containing the delimiter or newlines, escaped quotes ("" -> "),
 * CRLF/LF line endings, and trailing blank lines. Cells are returned verbatim
 * (no trimming); callers normalise as needed. Empty input returns [].
 */
export function parseDelimitedText(input: string, delimiter: string = ','): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
    } else if (char === delimiter) {
      endField();
      i += 1;
    } else if (char === '\r') {
      endRow();
      i += input[i + 1] === '\n' ? 2 : 1;
    } else if (char === '\n') {
      endRow();
      i += 1;
    } else {
      field += char;
      i += 1;
    }
  }

  if (field.length > 0 || row.length > 0) {
    endRow();
  }

  // Drop trailing blank lines (a row that is a single empty cell).
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') {
      rows.pop();
    } else {
      break;
    }
  }

  return rows;
}
