import { profileBackLink } from '@FE/utils/profile-back-link';

const names: Record<string, string> = { 'lab-1': 'Bacterial Genomics' };
const lookup = (id: string) => names[id];

describe('profileBackLink', () => {
  it('falls back to Organizations and labs when there is no previous page', () => {
    expect(profileBackLink('', lookup)).toEqual({ label: 'Back to Organizations and labs', to: '/labs' });
    expect(profileBackLink('/', lookup)).toEqual({ label: 'Back to Organizations and labs', to: '/labs' });
    expect(profileBackLink(null, lookup)).toEqual({ label: 'Back to Organizations and labs', to: '/labs' });
  });

  it('falls back to Organizations and labs when the previous page is not a lab', () => {
    expect(profileBackLink('/orgs', lookup)).toEqual({ label: 'Back to Organizations and labs', to: '/labs' });
    expect(profileBackLink('/labs', lookup)).toEqual({ label: 'Back to Organizations and labs', to: '/labs' });
  });

  it('names the lab and returns to the lab page', () => {
    expect(profileBackLink('/labs/lab-1', lookup)).toEqual({ label: 'Back to Bacterial Genomics', to: '/labs/lab-1' });
  });

  it('returns to the exact lab sub-page, query included', () => {
    expect(profileBackLink('/labs/lab-1/run/run-9?tab=files', lookup)).toEqual({
      label: 'Back to Bacterial Genomics',
      to: '/labs/lab-1/run/run-9?tab=files',
    });
  });

  it('falls back to Organizations and labs when the lab name is unknown', () => {
    expect(profileBackLink('/labs/lab-404', lookup)).toEqual({ label: 'Back to Organizations and labs', to: '/labs' });
  });

  it('does not treat lab-level static routes as lab ids', () => {
    expect(profileBackLink('/labs/create', lookup)).toEqual({ label: 'Back to Organizations and labs', to: '/labs' });
  });
});
