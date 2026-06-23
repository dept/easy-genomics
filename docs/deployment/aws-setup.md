# AWS Credentials Setup

Configure your local machine AWS CLI credentials before deploying.

NOTE: This step is not required if the configuration and deployment is from an AWS environment such as CloudShell, or
Cloud9.

```
[easy-genomics]$ aws configure
AWS Access Key ID [****************PXCF]:
AWS Secret Access Key [****************mipR]:
Default region name [us-east-1]:
Default output format [None]:
```

NOTE: If you are manually configuring the AWS CLI credentials, please ensure the AWS Region set matches the `aws-region`
setting in the `easy-genomics.yaml` configuration file.

Alternatively, if you have access to the AWS access portal copy and paste the temporary credentials provided into your
shell/terminal:

```
e.g.

export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."
```

Next: configure [`easy-genomics.yaml`](./configuration.md).
