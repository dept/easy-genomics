import { isEasyGenomicsDomainNestedStack } from '../../scripts/lib/is-easy-genomics-domain-nested-stack';

describe('isEasyGenomicsDomainNestedStack', () => {
  it('matches the pre-split easy-genomics domain nested stack logical id', () => {
    expect(isEasyGenomicsDomainNestedStack('easygenomicsnestedstack9A1B2C3D', undefined)).toBe(true);
  });

  it('matches ${envName}-easy-genomics-nested-stack when envName is easygenomics', () => {
    expect(
      isEasyGenomicsDomainNestedStack(
        'easygenomicseasygenomicsnestedstackNestedStackeasygenomicseasygenomicsnestedstackNestedStackResourceAABBCCDD',
        undefined,
      ),
    ).toBe(true);
  });

  it('matches domain nested stack physical ARN under main-back-end-stack', () => {
    expect(
      isEasyGenomicsDomainNestedStack(
        undefined,
        'arn:aws:cloudformation:us-east-1:009845682551:stack/dev-easygenomics-main-back-end-stack-easygenomicsnestedstackNESTED-ABC/uuid',
      ),
    ).toBe(true);
  });

  it('does not match Auth / HealthOmics / NF-Tower siblings when envName is easygenomics', () => {
    const siblings: Array<[string, string]> = [
      [
        'easygenomicsauthnestedstackNestedStackeasygenomicsauthnestedstackNestedStackResource1B02EB4D',
        'arn:aws:cloudformation:us-east-1:009845682551:stack/dev-easygenomics-main-back-end-stack-easygenomicsauthnestedstackNestedStackeasygenomic-KLFW33P0TUIV/f8607c90-1001-11f0-889d-12ef40d1bc4f',
      ],
      [
        'easygenomicsawshealthomicsnestedstackNestedStackeasygenomicsawshealthomicsnestedstackNestedStackResource4A8D8B5B',
        'arn:aws:cloudformation:us-east-1:009845682551:stack/dev-easygenomics-main-back-end-stack-easygenomicsawshealthomicsnestedstackNestedStacke-DAB54WP53GFF/3104a140-1002-11f0-889d-12ef40d1bc4f',
      ],
      [
        'easygenomicsnftowernestedstackNestedStackeasygenomicsnftowernestedstackNestedStackResource7CFF7334',
        'arn:aws:cloudformation:us-east-1:009845682551:stack/dev-easygenomics-main-back-end-stack-easygenomicsnftowernestedstackNestedStackeasygeno-HVQKRXK9S3ER/319d3250-1002-11f0-89e1-0e356142119b',
      ],
    ];

    for (const [logicalId, physicalId] of siblings) {
      expect(isEasyGenomicsDomainNestedStack(logicalId, physicalId)).toBe(false);
    }
  });

  it('does not match data-provisioning nested stack', () => {
    expect(
      isEasyGenomicsDomainNestedStack(
        'dataprovisioningnestedstackNestedStackdataprovisioningnestedstackNestedStackResource12345678',
        'arn:aws:cloudformation:us-east-1:009845682551:stack/dev-easygenomics-main-back-end-stack-dataprovisioningnested-XYZ/uuid',
      ),
    ).toBe(false);
  });

  it('returns false when both ids are missing', () => {
    expect(isEasyGenomicsDomainNestedStack(undefined, undefined)).toBe(false);
  });
});
