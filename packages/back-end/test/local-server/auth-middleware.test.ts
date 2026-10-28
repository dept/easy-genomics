import type { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import { validateSystemAdminAccess } from '../../src/app/utils/auth-utils';
import { payloadToClaims, runAuth } from '../../src/local-server/auth-middleware';

function unsignedToken(payload: Record<string, unknown>): string {
  const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

describe('payloadToClaims', () => {
  it('joins array claims so cognito:groups survives', () => {
    expect(payloadToClaims({ 'cognito:groups': ['SystemAdmin', 'Other'] })).toEqual({
      'cognito:groups': 'SystemAdmin,Other',
    });
  });

  it('keeps string and number claims and drops other values', () => {
    expect(payloadToClaims({ email: 'a@b.c', exp: 123, nested: { a: 1 }, flag: true })).toEqual({
      email: 'a@b.c',
      exp: '123',
    });
  });
});

describe('runAuth with SKIP_JWT_VERIFY', () => {
  const originalSkip = process.env.SKIP_JWT_VERIFY;

  beforeEach(() => {
    process.env.SKIP_JWT_VERIFY = 'true';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.SKIP_JWT_VERIFY = originalSkip;
    jest.restoreAllMocks();
  });

  it('returns claims that a system admin check accepts', async () => {
    const token = unsignedToken({ 'email': 'admin@example.com', 'cognito:groups': ['SystemAdmin'] });

    const result = await runAuth('GET', '/easy-genomics/organization/list-organizations', false, `Bearer ${token}`);

    expect(result.authorized).toBe(true);
    if (!result.authorized) return;
    const event = { requestContext: { authorizer: { claims: result.claims } } };
    expect(validateSystemAdminAccess(event as unknown as APIGatewayProxyWithCognitoAuthorizerEvent)).toBe(true);
  });
});
