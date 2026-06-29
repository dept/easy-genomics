import { getAnalyticsDeploymentIdSecretName, getAnalyticsSaltSecretName } from './analytics-utils';

describe('getAnalyticsDeploymentIdSecretName', () => {
  it('builds the conventional deployment-id secret name from the name prefix', () => {
    expect(getAnalyticsDeploymentIdSecretName('dev-myenv')).toBe('dev-myenv-easy-genomics-analytics-deployment-id');
    expect(getAnalyticsDeploymentIdSecretName('prod-acme')).toBe('prod-acme-easy-genomics-analytics-deployment-id');
  });
});

describe('getAnalyticsSaltSecretName', () => {
  it('builds the conventional salt secret name from the name prefix', () => {
    expect(getAnalyticsSaltSecretName('dev-myenv')).toBe('dev-myenv-easy-genomics-analytics-salt');
    expect(getAnalyticsSaltSecretName('prod-acme')).toBe('prod-acme-easy-genomics-analytics-salt');
  });
});
