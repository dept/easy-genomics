import { easyGenomicsApiName, mainBackEndApiName } from './api-gateway-names';

describe('API Gateway names', () => {
  it('gives the two REST APIs distinct names for every name prefix', () => {
    for (const namePrefix of ['dev-demo', 'dev-inistal', 'prod-wslh']) {
      expect(mainBackEndApiName(namePrefix)).not.toEqual(easyGenomicsApiName(namePrefix));
    }
  });

  // Pins the deployed names: these are physical resource names, and changing one
  // renames the API in place and breaks anything resolving it by name.
  it('builds each name from the supplied name prefix', () => {
    expect(mainBackEndApiName('dev-demo')).toEqual('dev-demo-main-back-end-apigw');
    expect(easyGenomicsApiName('dev-demo')).toEqual('dev-demo-easy-genomics-api-apigw');
  });
});
