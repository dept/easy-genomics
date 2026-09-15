import { isLaboratoryRunOwnedByUser } from '../../../src/app/utils/laboratory-run-ownership';

describe('isLaboratoryRunOwnedByUser', () => {
  const run = {
    UserId: 'c6705721-90ba-4d4a-9460-af2828bb4181',
    Owner: 'admin@easygenomics.org',
  };

  it('matches by UserId', () => {
    expect(
      isLaboratoryRunOwnedByUser(run, {
        id: 'c6705721-90ba-4d4a-9460-af2828bb4181',
        email: 'other@example.com',
      }),
    ).toBe(true);
  });

  it('matches by Owner email case-insensitively', () => {
    expect(
      isLaboratoryRunOwnedByUser(run, {
        id: '00000000-0000-0000-0000-000000000099',
        email: 'Admin@EasyGenomics.org',
      }),
    ).toBe(true);
  });

  it('returns false when neither UserId nor Owner match', () => {
    expect(
      isLaboratoryRunOwnedByUser(run, {
        id: '00000000-0000-0000-0000-000000000099',
        email: 'other@example.com',
      }),
    ).toBe(false);
  });

  it('returns false when user identity is missing', () => {
    expect(isLaboratoryRunOwnedByUser(run, { id: null, email: null })).toBe(false);
  });
});
