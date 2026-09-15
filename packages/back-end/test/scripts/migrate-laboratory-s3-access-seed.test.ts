const mockResolveNamePrefix = jest.fn();
jest.mock('../../scripts/lib/resolve-name-prefix', () => ({ resolveNamePrefix: mockResolveNamePrefix }));

const DYNAMODB_SERVICE_PATH = '../../src/app/services/dynamodb-service';
const S3_ACCESS_SERVICE_PATH = '../../src/app/services/easy-genomics/laboratory-s3-access-service';
const SCRIPT_MODULE_PATH = '../../scripts/migrate-laboratory-s3-access-seed';

interface ImportedScript {
  main: () => Promise<void>;
  findAll: jest.Mock;
  findAssignment: jest.Mock;
  upsert: jest.Mock;
}

/**
 * Fresh module registry per call so the script (and the locally-defined LaboratoryScanService
 * it exports through) picks up this call's mocked service implementations. Automocking
 * DynamoDBService/LaboratoryS3AccessService (rather than a factory replacement) is required
 * here specifically because LaboratoryScanService *extends* DynamoDBService — a factory mock
 * that returns a plain object from the constructor breaks that subclass's own prototype
 * methods (findAll is an arrow-function instance field, so it must be reassigned via
 * jest's automock-hoisted prototype, not stubbed out at the module-factory level).
 */
async function importScript(): Promise<ImportedScript> {
  jest.resetModules();
  jest.doMock(DYNAMODB_SERVICE_PATH);
  jest.doMock(S3_ACCESS_SERVICE_PATH);

  // Automocks are generated at runtime from the real classes, so the destructured exports
  // aren't statically typed as mocked — cast loosely rather than fight the compiler for a
  // test-only value.
  const { DynamoDBService } = (await import(DYNAMODB_SERVICE_PATH)) as any;
  const { LaboratoryS3AccessService } = (await import(S3_ACCESS_SERVICE_PATH)) as any;

  const findAll = jest.fn().mockResolvedValue({ Items: [] });
  const findAssignment = jest.fn().mockResolvedValue(undefined);
  const upsert = jest.fn();
  DynamoDBService.prototype.findAll = findAll;
  LaboratoryS3AccessService.prototype.findAssignment = findAssignment;
  LaboratoryS3AccessService.prototype.upsert = upsert;

  const { main } = await import(SCRIPT_MODULE_PATH);
  return { main, findAll, findAssignment, upsert };
}

describe('migrate-laboratory-s3-access-seed script', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    delete process.env.NAME_PREFIX;
  });

  afterEach(() => jest.restoreAllMocks());

  /**
   * registry.ts imports this module's `main` statically, which runs at module-import time —
   * before run-deploy-migrations.ts's entrypoint has loaded .env.local. If NAME_PREFIX
   * resolution (and the table name derived from it) happened at import time instead of when
   * main() actually runs, it would be permanently frozen to whatever was ambient before
   * .env.local loaded. Asserting zero calls right after import, and exactly one once main()
   * runs, is what would have caught that regression.
   */
  it('does not resolve NAME_PREFIX at import time, only when main() runs', async () => {
    mockResolveNamePrefix.mockReturnValue('dev-demo');

    const { main, findAll } = await importScript();
    expect(mockResolveNamePrefix).not.toHaveBeenCalled();

    await main();

    expect(mockResolveNamePrefix).toHaveBeenCalledTimes(1);
    expect(findAll).toHaveBeenCalledWith(expect.objectContaining({ TableName: 'dev-demo-laboratory-table' }));
    expect(process.env.NAME_PREFIX).toBe('dev-demo');
  });

  it('seeds an ALLOW row for a lab with a configured bucket and no existing assignment', async () => {
    mockResolveNamePrefix.mockReturnValue('dev-demo');

    const { main, findAll, upsert } = await importScript();
    findAll.mockResolvedValue({
      Items: [
        {
          LaboratoryId: { S: 'lab-1' },
          OrganizationId: { S: 'org-1' },
          S3Bucket: { S: 'bucket-a' },
        },
      ],
    });

    await main();

    expect(upsert).toHaveBeenCalledWith({
      LaboratoryId: 'lab-1',
      BucketName: 'bucket-a',
      OrganizationId: 'org-1',
      Effect: 'ALLOW',
    });
  });
});
