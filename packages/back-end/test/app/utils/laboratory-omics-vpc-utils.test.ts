import { ResourceNotFoundException } from '@aws-sdk/client-omics';
import { assertHealthOmicsVpcConfigurationIsActive } from '../../../src/app/utils/laboratory-omics-vpc-utils';
import { OmicsService } from '../../../src/app/services/omics-service';

jest.mock('../../../src/app/services/omics-service');

describe('assertHealthOmicsVpcConfigurationIsActive', () => {
  let mockOmicsService: jest.MockedClass<typeof OmicsService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOmicsService = OmicsService as jest.MockedClass<typeof OmicsService>;
    mockOmicsService.prototype.getConfiguration = jest.fn();
  });

  it('resolves when the configuration exists and is ACTIVE', async () => {
    (mockOmicsService.prototype.getConfiguration as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
    const omicsService = new OmicsService();

    await expect(assertHealthOmicsVpcConfigurationIsActive('wslh-prod-vpc', omicsService)).resolves.toBeUndefined();
    expect(omicsService.getConfiguration).toHaveBeenCalledWith({ name: 'wslh-prod-vpc' });
  });

  it('throws LaboratoryHealthOmicsConfigurationNotActiveError when status is not ACTIVE', async () => {
    (mockOmicsService.prototype.getConfiguration as jest.Mock).mockResolvedValue({ status: 'CREATING' });
    const omicsService = new OmicsService();

    await expect(assertHealthOmicsVpcConfigurationIsActive('wslh-prod-vpc', omicsService)).rejects.toMatchObject({
      errorCode: 'EG-310',
      statusCode: 400,
    });
  });

  it('throws LaboratoryHealthOmicsConfigurationNotFoundError when the configuration does not exist', async () => {
    (mockOmicsService.prototype.getConfiguration as jest.Mock).mockRejectedValue(
      new ResourceNotFoundException({ message: 'not found', $metadata: {} } as any),
    );
    const omicsService = new OmicsService();

    await expect(assertHealthOmicsVpcConfigurationIsActive('missing-vpc', omicsService)).rejects.toMatchObject({
      errorCode: 'EG-309',
      statusCode: 404,
    });
  });

  it('rethrows unrelated errors unchanged', async () => {
    const unrelated = new Error('network blip');
    (mockOmicsService.prototype.getConfiguration as jest.Mock).mockRejectedValue(unrelated);
    const omicsService = new OmicsService();

    await expect(assertHealthOmicsVpcConfigurationIsActive('wslh-prod-vpc', omicsService)).rejects.toBe(unrelated);
  });
});
