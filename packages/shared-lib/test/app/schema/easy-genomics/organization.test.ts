import { OrganizationSchema, UpdateOrganizationSchema } from '../../../../src/app/schema/easy-genomics/organization';

const base = {
  OrganizationId: '11111111-1111-1111-1111-111111111111',
  Name: 'Test Org',
};

describe('OrganizationSchema email branding fields', () => {
  it('accepts a valid EmailBrandingLogoUrl', () => {
    const result = OrganizationSchema.safeParse({
      ...base,
      EmailBrandingLogoUrl: 'https://example.com/logo.png',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-URL EmailBrandingLogoUrl', () => {
    const result = OrganizationSchema.safeParse({
      ...base,
      EmailBrandingLogoUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an empty string EmailBrandingLogoUrl (clearing the field back to default)', () => {
    const result = OrganizationSchema.safeParse({
      ...base,
      EmailBrandingLogoUrl: '',
    });
    expect(result.success).toBe(true);
  });

  it('allows EmailBrandingLogoUrl to be omitted', () => {
    const result = OrganizationSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('UpdateOrganizationSchema also accepts EmailBrandingLogoUrl', () => {
    const result = UpdateOrganizationSchema.safeParse({
      Name: 'Test Org',
      EmailBrandingLogoUrl: 'https://example.com/logo.png',
    });
    expect(result.success).toBe(true);
  });
});
