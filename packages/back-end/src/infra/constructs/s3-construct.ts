import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface S3ConstructProps {}

export class S3Construct extends Construct {
  readonly props: S3ConstructProps;

  constructor(scope: Construct, id: string, props: S3ConstructProps) {
    super(scope, id);
    this.props = props;
  }

  public createBucket = (envType: string, envBucketName?: string): Bucket => {
    const removalPolicy = envType !== 'prod' ? RemovalPolicy.DESTROY : undefined; // Only for Non-Prod
    const constructId = envBucketName ?? `bucket-${Math.floor(Math.random() * 10000)}`;

    const bucket = new Bucket(this, constructId, {
      bucketName: envType === 'prod' ? envBucketName : undefined,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      bucketKeyEnabled: true,
      autoDeleteObjects: true,
      removalPolicy: removalPolicy,
      enforceSSL: true,
      lifecycleRules: [
        {
          prefix: 'uploads',
          abortIncompleteMultipartUploadAfter: Duration.days(2),
          enabled: true,
        },
      ],
      cors: [
        {
          allowedMethods: [HttpMethods.GET, HttpMethods.POST, HttpMethods.PUT, HttpMethods.HEAD],
          allowedOrigins: ['*'], // TODO: Restrict to domain in configuration file
          allowedHeaders: ['*'],
        },
      ],
    });
    return bucket;
  };
}
