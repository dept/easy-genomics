import { FrontEndStackProps } from '@easy-genomics/shared-lib/src/infra/types/main-stack';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { WwwHostingConstruct } from '../constructs/www-hosting-construct';

/**
 * This Front-End Stack defines the core AWS infrastructure required for static web hosting including:
 *  - S3 Bucket
 *  - CloudFront Distribution
 *  - Certificate
 */
export class FrontEndStack extends Stack {
  readonly props: FrontEndStackProps;
  protected wwwHosting!: WwwHostingConstruct;

  constructor(scope: Construct, id: string, props: FrontEndStackProps) {
    super(scope, id, props);
    this.props = props;

    this.wwwHosting = this.setupWwwHosting();
  }

  // Returns WWW Hosting Construct for easier access to associated objects
  private setupWwwHosting = (): WwwHostingConstruct => {
    return new WwwHostingConstruct(this, `${this.props.constructNamespace}-www`, {
      ...this.props,
      description: 'Easy Genomics WWW Static Hosting',
    });
  };
}
