import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import { LogRetention, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface LogRetentionNestedStackProps extends NestedStackProps {
  /**
   * Absolute CloudWatch log group names (e.g. `/aws/lambda/<functionName>`).
   * Names must be deterministic so this stack can apply retention without
   * taking a cross-stack reference to the Lambda functions themselves.
   */
  logGroupNames: string[];
  retention?: RetentionDays;
}

/**
 * Sibling nested stack that owns every `Custom::LogRetention` resource for a
 * domain's Lambdas. Keeping these out of the route-heavy Easy Genomics nested
 * stack is what makes the CloudFormation 500-resource budget feasible —
 * Custom::LogRetention has no physical identity, so relocating them across
 * templates is a pure delete/recreate with an idempotent PutRetentionPolicy.
 */
export class LogRetentionNestedStack extends NestedStack {
  constructor(scope: Construct, id: string, props: LogRetentionNestedStackProps) {
    super(scope, id, props);

    const retention = props.retention ?? RetentionDays.ONE_DAY;
    // Deduplicate in case multiple LambdaConstructs share a namespace.
    const uniqueNames = [...new Set(props.logGroupNames)];

    uniqueNames.forEach((logGroupName, index) => {
      // Construct ids must be unique and reasonably short; index + a sanitized
      // suffix keeps them stable across synths as long as logGroupNames order
      // is stable (LambdaConstruct registers handlers in filesystem walk order).
      const sanitized = logGroupName.replace(/[^A-Za-z0-9]/g, '').slice(-48);
      new LogRetention(this, `lr${index}-${sanitized}`, {
        logGroupName,
        retention,
        logRetentionRetryOptions: {
          // Attempt to avoid LogRetention creation failure due to throttling
          maxRetries: 10, // AWS default is 3
        },
      });
    });
  }
}
