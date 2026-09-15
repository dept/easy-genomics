import { ResourceNotFoundException } from '@aws-sdk/client-omics';
import {
  LaboratoryHealthOmicsConfigurationNotActiveError,
  LaboratoryHealthOmicsConfigurationNotFoundError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { OmicsService } from '@BE/services/omics-service';

export async function assertHealthOmicsVpcConfigurationIsActive(
  configurationName: string,
  omicsService: OmicsService,
): Promise<void> {
  const configuration = await omicsService.getConfiguration({ name: configurationName }).catch((error: any) => {
    if (error instanceof ResourceNotFoundException) {
      throw new LaboratoryHealthOmicsConfigurationNotFoundError(configurationName);
    }
    throw error;
  });

  if (configuration.status !== 'ACTIVE') {
    throw new LaboratoryHealthOmicsConfigurationNotActiveError(configurationName, configuration.status ?? 'UNKNOWN');
  }
}
