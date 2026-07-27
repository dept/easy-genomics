export type E2EEnvironment = 'qa' | 'uat';

export type UserRole = 'sys-admin' | 'org-admin' | 'lab-manager' | 'lab-technician';

export const environments = {
  qa: {
    name: 'QA',
    baseURL: 'https://quality.dev.easygenomics.org',
    password: '123456!Qa',
  },
  uat: {
    name: 'UAT',
    baseURL: 'https://quality.uat.easygenomics.org',
    password: 'EasyGenomicsUAT2026!',
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
  'sys-admin': { email: 'sysadmin@easygenomics.org' },
  'org-admin': { email: 'admin@easygenomics.org' },
  'lab-manager': { email: 'lab.manager@easygenomics.org' },
  'lab-technician': { email: 'lab.technician@easygenomics.org' },
};

export function getE2EEnvironment(): E2EEnvironment {
  const env = (process.env.E2E_ENV ?? 'qa').toLowerCase();
  if (env !== 'qa' && env !== 'uat') {
    throw new Error(`Invalid E2E_ENV="${env}". Use "qa" or "uat".`);
  }
  return env;
}

export function getEnvironmentConfig(env: E2EEnvironment = getE2EEnvironment()) {
  return environments[env];
}

export function getRoleCredentials(role: UserRole, env: E2EEnvironment = getE2EEnvironment()) {
  return {
    email: roleCredentials[role].email,
    password: environments[env].password,
  };
}
