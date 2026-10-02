import { resolveAuthGuard, AUTH_GUARD_EXEMPT_PATHS } from '../../../src/app/utils/auth-guard';

const origin = 'https://app.example.com';

function ctx(overrides: Partial<Parameters<typeof resolveAuthGuard>[2]> = {}) {
  return {
    getToken: jest.fn().mockResolvedValue('jwt'),
    navigateTo: jest.fn(),
    isLoggingOut: false,
    toastSessionError: jest.fn(),
    isSuperuser: false,
    signOut: jest.fn().mockResolvedValue(undefined),
    storage: undefined,
    ...overrides,
  };
}

describe('resolveAuthGuard', () => {
  it('redirects a signed-in user away from /signin to /labs', async () => {
    const guard = ctx();
    await resolveAuthGuard({ fullPath: '/signin' }, origin, guard);
    expect(guard.navigateTo).toHaveBeenCalledWith('/labs');
  });

  it('redirects a signed-out user on an authed page to /signin and toasts', async () => {
    const guard = ctx({ getToken: jest.fn().mockRejectedValue(new Error('no session')) });
    await resolveAuthGuard({ fullPath: '/labs' }, origin, guard);
    expect(guard.toastSessionError).toHaveBeenCalled();
    expect(guard.navigateTo).toHaveBeenCalledWith('/signin');
  });

  it('does not toast when signing out', async () => {
    const guard = ctx({
      getToken: jest.fn().mockRejectedValue(new Error('no session')),
      isLoggingOut: true,
    });
    await resolveAuthGuard({ fullPath: '/labs' }, origin, guard);
    expect(guard.toastSessionError).not.toHaveBeenCalled();
    expect(guard.navigateTo).toHaveBeenCalledWith('/signin');
  });

  it('does not redirect a signed-out user already on /signin', async () => {
    const guard = ctx({ getToken: jest.fn().mockRejectedValue(new Error('no session')) });
    await resolveAuthGuard({ fullPath: '/signin' }, origin, guard);
    expect(guard.navigateTo).not.toHaveBeenCalled();
    expect(guard.toastSessionError).not.toHaveBeenCalled();
  });

  it('skips the session check on /auth/callback', async () => {
    const guard = ctx({ getToken: jest.fn().mockRejectedValue(new Error('inflight')) });
    await resolveAuthGuard({ fullPath: '/auth/callback?code=abc&state=xyz' }, origin, guard);
    expect(guard.getToken).not.toHaveBeenCalled();
    expect(guard.navigateTo).not.toHaveBeenCalled();
  });

  it('lets /accept-invitation through when an invite token is present', async () => {
    const guard = ctx({ getToken: jest.fn().mockRejectedValue(new Error('no session')) });
    await resolveAuthGuard({ fullPath: '/accept-invitation?invite=token' }, origin, guard);
    expect(guard.getToken).not.toHaveBeenCalled();
    expect(guard.navigateTo).not.toHaveBeenCalled();
  });

  it('redirects /accept-invitation without an invite token to /signin', async () => {
    const guard = ctx();
    await resolveAuthGuard({ fullPath: '/accept-invitation' }, origin, guard);
    expect(guard.navigateTo).toHaveBeenCalledWith('/signin');
  });

  it('does not redirect /accept-invitation when the query is an email', async () => {
    const guard = ctx();
    await resolveAuthGuard({ fullPath: '/accept-invitation?email=a@b.com' }, origin, guard);
    expect(guard.navigateTo).not.toHaveBeenCalled();
  });

  it('redirects /reset-password without a token to /signin', async () => {
    const guard = ctx();
    await resolveAuthGuard({ fullPath: '/reset-password' }, origin, guard);
    expect(guard.navigateTo).toHaveBeenCalledWith('/signin');
  });

  it('lets /reset-password through when a forgot-password token is present', async () => {
    const guard = ctx({ getToken: jest.fn().mockRejectedValue(new Error('no session')) });
    await resolveAuthGuard({ fullPath: '/reset-password?forgot-password=token' }, origin, guard);
    expect(guard.getToken).not.toHaveBeenCalled();
    expect(guard.navigateTo).not.toHaveBeenCalled();
  });

  it('sends a superuser to /admin plus the requested path', async () => {
    const guard = ctx({ isSuperuser: true });
    await resolveAuthGuard({ fullPath: '/labs' }, origin, guard);
    expect(guard.navigateTo).toHaveBeenCalledWith('/admin/labs');
  });

  it('strips /admin for a non-superuser', async () => {
    const guard = ctx();
    await resolveAuthGuard({ fullPath: '/admin/labs' }, origin, guard);
    expect(guard.navigateTo).toHaveBeenCalledWith('/labs');
  });

  it('signs a superuser out when they hit an invite link', async () => {
    const guard = ctx({ isSuperuser: true });
    await resolveAuthGuard({ fullPath: '/accept-invitation?invite=token' }, origin, guard);
    expect(guard.signOut).toHaveBeenCalled();
  });

  it('includes /auth/callback in the exempt path list', () => {
    expect(AUTH_GUARD_EXEMPT_PATHS).toContain('/auth/callback');
  });
});
