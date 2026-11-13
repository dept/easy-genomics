import { firstTierUsdPrice, PricingService } from '../../../src/app/services/pricing-service';

const priceListEntry = JSON.stringify({
  terms: {
    OnDemand: {
      'SKU.OFFER': {
        priceDimensions: {
          'SKU.OFFER.TIER2': { beginRange: '51200', pricePerUnit: { USD: '0.0220000000' } },
          'SKU.OFFER.TIER1': { beginRange: '0', pricePerUnit: { USD: '0.0230000000' } },
        },
      },
    },
  },
});

describe('PricingService', () => {
  it('reads the first-tier USD price from a Price List entry', () => {
    expect(firstTierUsdPrice(priceListEntry)).toBe(0.023);
    expect(firstTierUsdPrice(undefined)).toBeUndefined();
    expect(firstTierUsdPrice(JSON.stringify({ terms: {} }))).toBeUndefined();
  });

  it('caches the price per region and hides failures as undefined', async () => {
    const send = jest.fn().mockResolvedValueOnce({ PriceList: [priceListEntry] }).mockRejectedValueOnce(new Error('x'));
    const service = new PricingService({ send } as any);

    expect(await service.getS3StandardPricePerGbMonth('us-east-1')).toBe(0.023);
    expect(await service.getS3StandardPricePerGbMonth('us-east-1')).toBe(0.023);
    expect(await service.getS3StandardPricePerGbMonth('eu-west-1')).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
