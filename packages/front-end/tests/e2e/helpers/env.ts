import fs from 'fs';
import path from 'path';

export type E2EEnvironment = 'qa' | 'uat';

export type UserRole = 'sys-admin' | 'org-admin' | 'lab-manager' | 'lab-technician';

const DEFAULT_ENVIRONMENTS = {
  qa: {
    name: 'QA',
    baseURL: 'https://quality.dev.easygenomics.org',
  },
  uat: {
    name: 'UAT',
    baseURL: 'https://quality.uat.easygenomics.org',
  },
} as const;

const DEFAULT_ROLE_EMAILS: Record<UserRole, string> = {
  'sys-admin': 'sysadmin@easygenomics.org',
  'org-admin': 'admin@easygenomics.org',
  'lab-manager': 'lab.manager@easygenomics.org',
  'lab-technician': 'lab.technician@easygenomics.org',
};

const ROLE_ENV_KEYS: Record<UserRole, { email: string; password: string }> = {
  'sys-admin': { email: 'E2E_SYS_ADMIN_EMAIL', password: 'E2E_SYS_ADMIN_PASSWORD' },
  'org-admin': { email: 'E2E_ORG_ADMIN_EMAIL', password: 'E2E_ORG_ADMIN_PASSWORD' },
  'lab-manager': { email: 'E2E_LAB_MANAGER_EMAIL', password: 'E2E_LAB_MANAGER_PASSWORD' },
  'lab-technician': { email: 'E2E_LAB_TECHNICIAN_EMAIL', password: 'E2E_LAB_TECHNICIAN_PASSWORD' },
};

/** Legacy shared passwords used by older e2e helpers when per-role env is unset. */
const LEGACY_SHARED_PASSWORD: Record<E2EEnvironment, string> = {
  qa: '123456!Qa',
  uat: 'EasyGenomicsUAT2026!',
};

let smokeEnvLoaded = false;

/**
 * Loads specs/smoke-discovery/.env.local into process.env when present (does not override existing env).
 */
export function loadSmokeEnvFile(): void {
  if (smokeEnvLoaded) return;
  smokeEnvLoaded = true;

  const candidates = [
    path.resolve(__dirname, '../../../../specs/smoke-discovery/.env.local'),
    path.resolve(process.cwd(), 'specs/smoke-discovery/.env.local'),
    path.resolve(process.cwd(), '../../specs/smoke-discovery/.env.local'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const i = trimmed.indexOf('=');
      const key = trimmed.slice(0, i).trim();
      const value = trimmed.slice(i + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    break;
  }
}

loadSmokeEnvFile();

export const environments = {
  qa: {
    name: DEFAULT_ENVIRONMENTS.qa.name,
    baseURL: process.env.E2E_BASE_URL?.replace(/\/$/, '') || DEFAULT_ENVIRONMENTS.qa.baseURL,
    password: process.env.E2E_ORG_ADMIN_PASSWORD || LEGACY_SHARED_PASSWORD.qa,
  },
  uat: {
    name: DEFAULT_ENVIRONMENTS.uat.name,
    baseURL:
      process.env.E2E_BASE_URL?.replace(/\/$/, '') && process.env.E2E_ENV === 'uat'
        ? process.env.E2E_BASE_URL.replace(/\/$/, '')
        : DEFAULT_ENVIRONMENTS.uat.baseURL,
    password: process.env.E2E_ORG_ADMIN_PASSWORD || LEGACY_SHARED_PASSWORD.uat,
  },
} as const satisfies Record<
  E2EEnvironment,
  {
    name: string;
    baseURL: string;
    password: string;
  }
>;

export const roleCredentials: Record<UserRole, { email: string }> = {
  'sys-admin': { email: process.env.E2E_SYS_ADMIN_EMAIL || DEFAULT_ROLE_EMAILS['sys-admin'] },
  'org-admin': { email: process.env.E2E_ORG_ADMIN_EMAIL || DEFAULT_ROLE_EMAILS['org-admin'] },
  'lab-manager': { email: process.env.E2E_LAB_MANAGER_EMAIL || DEFAULT_ROLE_EMAILS['lab-manager'] },
  'lab-technician': {
    email: process.env.E2E_LAB_TECHNICIAN_EMAIL || DEFAULT_ROLE_EMAILS['lab-technician'],
  },
};

export function getE2EEnvironment(): E2EEnvironment {
  const env = (process.env.E2E_ENV ?? 'qa').toLowerCase();
  if (env !== 'qa' && env !== 'uat') {
    throw new Error(`Invalid E2E_ENV="${env}". Use "qa" or "uat".`);
  }
  return env;
}

export function getEnvironmentConfig(env: E2EEnvironment = getE2EEnvironment()) {
  const baseFromEnv = process.env.E2E_BASE_URL?.replace(/\/$/, '');
  return {
    name: environments[env].name,
    baseURL: baseFromEnv || environments[env].baseURL,
    password: environments[env].password,
  };
}

export function getRoleCredentials(role: UserRole, env: E2EEnvironment = getE2EEnvironment()) {
  const email = process.env[ROLE_ENV_KEYS[role].email] || roleCredentials[role].email;
  const password =
    process.env[ROLE_ENV_KEYS[role].password] ||
    process.env.E2E_PASSWORD ||
    environments[env].password;

  if (!email || !password) {
    throw new Error(`Missing credentials for role "${role}". Set E2E_* env or smoke .env.local.`);
  }

  return { email, password };
}

/** Optional explicit lab ids for smoke (preferred when set). */
export function getSmokeLabIds() {
  return {
    managerLabId: process.env.E2E_LAB_MANAGER_LAB_ID || undefined,
    technicianOnlyLabId: process.env.E2E_LAB_TECHNICIAN_LAB_ID || undefined,
    orgAdminLabId: process.env.E2E_ORG_ADMIN_LAB_ID || undefined,
  };
}
