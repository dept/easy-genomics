import { createSingleFlight } from '../../../src/app/utils/single-flight';

describe('createSingleFlight', () => {
  it('shares one in-flight promise across concurrent callers', async () => {
    let resolveFirst!: (value: string) => void;
    const run = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const gated = createSingleFlight(run);

    const first = gated();
    const second = gated();
    expect(run).toHaveBeenCalledTimes(1);

    resolveFirst('token');
    await expect(Promise.all([first, second])).resolves.toEqual(['token', 'token']);
  });

  it('starts a new run after the previous one settles', async () => {
    const run = jest.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b');
    const gated = createSingleFlight(run);

    await expect(gated()).resolves.toBe('a');
    await expect(gated()).resolves.toBe('b');
    expect(run).toHaveBeenCalledTimes(2);
  });
});
