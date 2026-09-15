import { isStackMissingError } from '../../scripts/lib/cloudformation-stack';

describe('isStackMissingError', () => {
  it('matches CloudFormation stack-does-not-exist errors', () => {
    expect(isStackMissingError(new Error('Stack with id foo does not exist'))).toBe(true);
    expect(isStackMissingError('AccessDenied')).toBe(false);
  });
});
