import {
  CreateLaboratorySchema,
  LaboratorySchema,
  UpdateLaboratorySchema,
} from '../../../../src/app/schema/easy-genomics/laboratory';

describe('Laboratory schema — AwsHealthOmicsNetworkingMode / AwsHealthOmicsVpcConfigurationName', () => {
  const baseCreate = {
    OrganizationId: '00000000-0000-0000-0000-000000000001',
    Name: 'Test Lab',
    Status: 'Active' as const,
  };

  const baseUpdate = {
    Name: 'Test Lab',
    Status: 'Active' as const,
  };

  const baseFull = {
    OrganizationId: '00000000-0000-0000-0000-000000000001',
    LaboratoryId: '00000000-0000-0000-0000-000000000002',
    Name: 'Test Lab',
    Status: 'Active' as const,
  };

  it('CreateLaboratorySchema accepts VPC mode with a configuration name', () => {
    const result = CreateLaboratorySchema.safeParse({
      ...baseCreate,
      AwsHealthOmicsNetworkingMode: 'VPC',
      AwsHealthOmicsVpcConfigurationName: 'wslh-prod-vpc',
    });
    expect(result.success).toBe(true);
  });

  it('CreateLaboratorySchema rejects VPC mode without a configuration name', () => {
    const result = CreateLaboratorySchema.safeParse({
      ...baseCreate,
      AwsHealthOmicsNetworkingMode: 'VPC',
    });
    expect(result.success).toBe(false);
  });

  it('CreateLaboratorySchema rejects VPC mode with an empty configuration name', () => {
    const result = CreateLaboratorySchema.safeParse({
      ...baseCreate,
      AwsHealthOmicsNetworkingMode: 'VPC',
      AwsHealthOmicsVpcConfigurationName: '',
    });
    expect(result.success).toBe(false);
  });

  it('CreateLaboratorySchema accepts omitted networking mode (defaults to RESTRICTED behaviour)', () => {
    const result = CreateLaboratorySchema.safeParse(baseCreate);
    expect(result.success).toBe(true);
  });

  it('CreateLaboratorySchema accepts VPC mode with a configuration name even when AwsHealthOmicsEnabled is false', () => {
    const result = CreateLaboratorySchema.safeParse({
      ...baseCreate,
      AwsHealthOmicsEnabled: false,
      AwsHealthOmicsNetworkingMode: 'VPC',
      AwsHealthOmicsVpcConfigurationName: 'wslh-prod-vpc',
    });
    expect(result.success).toBe(true);
  });

  it('CreateLaboratorySchema rejects an unsupported networking mode value', () => {
    const result = CreateLaboratorySchema.safeParse({
      ...baseCreate,
      AwsHealthOmicsNetworkingMode: 'PUBLIC',
    });
    expect(result.success).toBe(false);
  });

  it('CreateLaboratorySchema rejects a configuration name longer than 50 characters', () => {
    const result = CreateLaboratorySchema.safeParse({
      ...baseCreate,
      AwsHealthOmicsNetworkingMode: 'VPC',
      AwsHealthOmicsVpcConfigurationName: 'x'.repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it('UpdateLaboratorySchema rejects VPC mode without a configuration name', () => {
    const result = UpdateLaboratorySchema.safeParse({
      ...baseUpdate,
      AwsHealthOmicsNetworkingMode: 'VPC',
    });
    expect(result.success).toBe(false);
  });

  it('UpdateLaboratorySchema accepts VPC mode with a configuration name', () => {
    const result = UpdateLaboratorySchema.safeParse({
      ...baseUpdate,
      AwsHealthOmicsNetworkingMode: 'VPC',
      AwsHealthOmicsVpcConfigurationName: 'wslh-prod-vpc',
    });
    expect(result.success).toBe(true);
  });

  it('LaboratorySchema (full persisted item) accepts VPC mode with a configuration name', () => {
    const result = LaboratorySchema.safeParse({
      ...baseFull,
      AwsHealthOmicsNetworkingMode: 'VPC',
      AwsHealthOmicsVpcConfigurationName: 'wslh-prod-vpc',
    });
    expect(result.success).toBe(true);
  });
});
