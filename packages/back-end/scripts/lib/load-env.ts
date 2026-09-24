import path from 'path';
import dotenv from 'dotenv';

/**
 * Loads `.env.local` (if present) and reconciles `REGION`/`AWS_REGION` so either one being
 * set is enough for both the app's own config code (`REGION`) and the AWS SDK (`AWS_REGION`,
 * which is all it recognizes) to work. Must run before constructing any AWS SDK client.
 */
export function loadDotEnvAndReconcileRegion(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  dotenv.config({ path: envPath });
  if (process.env.REGION && !process.env.AWS_REGION) {
    process.env.AWS_REGION = process.env.REGION;
  }
  if (!process.env.REGION && process.env.AWS_REGION) {
    process.env.REGION = process.env.AWS_REGION;
  }
}
