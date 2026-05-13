import { BackEndStackProps } from '@easy-genomics/shared-lib/src/infra/types/main-stack';
import { CfnOutput } from 'aws-cdk-lib';
import {
  CfnRoute,
  CfnVPCPeeringConnection,
  DefaultInstanceTenancy,
  GatewayVpcEndpoint,
  GatewayVpcEndpointAwsService,
  IpAddresses,
  ISubnet,
  IVpc,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface VpcConstructProps extends BackEndStackProps {}

/**
 *
 */
export class VpcConstruct extends Construct {
  readonly props: VpcConstructProps;
  readonly vpc: IVpc;
  readonly dynamoDbEndpoint: GatewayVpcEndpoint;
  readonly s3Endpoint: GatewayVpcEndpoint;
  readonly vpcPeeringConnection: CfnVPCPeeringConnection | undefined;

  constructor(scope: Construct, id: string, props: VpcConstructProps) {
    super(scope, id);
    this.props = props;

    // Create VPC with IP Range => 10.11.XXX.XXX
    this.vpc = new Vpc(this, `${this.props.constructNamespace}-vpc`, {
      vpcName: 'easy-genomics-vpc',
      defaultInstanceTenancy: DefaultInstanceTenancy.DEFAULT,
      ipAddresses: IpAddresses.cidr('10.11.0.0/16'), // IP range: 10.11.0.4 to 10.11.255.254 (65531 host IPs)
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: 'public-subnet',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 27, // 27 IP addresses
        },
        {
          name: 'private-subnet',
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 20, // 4091 IP addresses
        },
      ],
      natGateways: 0,
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    this.dynamoDbEndpoint = new GatewayVpcEndpoint(this, `${this.props.constructNamespace}-vpc-dynamodb-endpoint`, {
      vpc: this.vpc,
      service: GatewayVpcEndpointAwsService.DYNAMODB,
    });

    this.s3Endpoint = new GatewayVpcEndpoint(this, `${this.props.constructNamespace}-vpc-s3-endpoint`, {
      vpc: this.vpc,
      service: GatewayVpcEndpointAwsService.S3,
    });

    if (this.props.vpcPeering) {
      // Setup peering connection
      this.vpcPeeringConnection = new CfnVPCPeeringConnection(
        this,
        `${this.props.constructNamespace}-vpc-peering-connection`,
        {
          vpcId: this.vpc.vpcId, // Requester
          peerVpcId: this.props.vpcPeering.externalVpcId, // Accepter
          peerOwnerId: this.props.vpcPeering.externalAwsAccountId,
          peerRegion: this.props.vpcPeering.externalAwsRegion,
          peerRoleArn: this.props.vpcPeering.externalRoleArn,
          tags: [{ key: 'Name', value: 'Requester -> Accepter' }],
        },
      );

      if (this.vpcPeeringConnection) {
        // Setup private subnet routing to Accepter's network
        this.vpc.privateSubnets.forEach((p: ISubnet, index: number) => {
          const route = new CfnRoute(this, `-${index}`, {
            destinationCidrBlock: this.props.vpcPeering?.externalCidrBlock,
            routeTableId: p.routeTable.routeTableId,
            vpcPeeringConnectionId: this.vpcPeeringConnection?.ref,
          });
          route.addDependency(this.vpcPeeringConnection!);
        });
      }
    }

    const exportPrefix = this.props.envType === 'prod' ? '' : `${this.props.envType}-${this.props.envName}-`;
    new CfnOutput(this, 'VpcId', { key: 'VpcId', value: this.vpc.vpcId, exportName: `${exportPrefix}VpcId` });
    new CfnOutput(this, 'VpcArn', { key: 'VpcArn', value: this.vpc.vpcArn, exportName: `${exportPrefix}VpcArn` });
  }
}
