import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { CacheCookieBehavior, CacheHeaderBehavior, CachePolicy, CacheQueryStringBehavior, Distribution, OriginAccessIdentity, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { HttpOrigin, S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { readFileSync } from 'fs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';

export interface ExtendedStackProps extends cdk.StackProps {
  readonly namingPrefix: string;
  readonly ghOrgName: string,
  readonly ec2KeyPairName: string,
  readonly dbUsername: string,
  readonly dbPort: number,
  readonly frontEndDomain: string,
  readonly frontEndCertArn: string,
  readonly apiDomain: string,
  readonly apiCertArn: string,
  readonly configParamName: string,
  readonly mTlsPemPath: string,
  readonly mTlsBucketName: string,
}

export class ShortTermLenderInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ExtendedStackProps) {
    super(scope, id, props);

    // -== Requires initial bootstrapping ==-
    // ===== Step No. 1 =====
    initializeOidcProvider(this, props.ghOrgName, this.account, props.namingPrefix);

    // ===== Step No. 2 =====
    const vpc = createVpc(this, props.namingPrefix);

    // ===== Step No. 3 =====
    const s3Bucket = createS3Bucket(this, props.namingPrefix);
    const ec2Instance = createEC2Instance(this, vpc, props.ec2KeyPairName, props.namingPrefix);

    // ===== Step No. 4 =====
    initializeCloudFrontDistribution(this, s3Bucket, props.frontEndDomain, props.frontEndCertArn, props.namingPrefix);
    initializeApiGateWay(this, ec2Instance, props.apiDomain, props.apiCertArn, props.namingPrefix, props.mTlsPemPath, props.mTlsBucketName);

    initializeCognito(this, props.namingPrefix, props.frontEndDomain);

    // ===== Step No. 5 =====
    const db = createDBInstance(this, vpc, props.dbUsername, props.dbPort, props.namingPrefix);
    db.connections.allowFrom(ec2Instance, ec2.Port.tcp(props.dbPort));

    // ======================
    const configFileJs = readFileSync('./lib/config.js', 'utf-8');
    const configParam = new StringParameter(this, `${props.namingPrefix}-config-param`, {
      stringValue: configFileJs,
      parameterName: props.configParamName,
    })
  }
}

const initializeApiGateWay = (scope: Construct, ec2: ec2.Instance, domainNames: string, certArn: string, namingPrefix: string, mTlsPemPath: string, mTlsBucketName: string) => {
  const api = new apigatewayv2.HttpApi(scope, `${namingPrefix}-api-gateway`, { disableExecuteApiEndpoint: true });

  const proxyIntegration = new integrations.HttpUrlIntegration(`${namingPrefix}-proxy-int`, `http://${ec2.instancePublicIp}:5000/{proxy}`);

  api.addRoutes({
    path: '/{proxy+}',
    integration: proxyIntegration,
    methods: [apigatewayv2.HttpMethod.ANY],
  });

  const domainName = new apigatewayv2.DomainName(scope, `${namingPrefix}-custom-domain`, {
    domainName: domainNames,
    certificate: Certificate.fromCertificateArn(scope, `${namingPrefix}-api-cert`, certArn),
    endpointType: apigatewayv2.EndpointType.REGIONAL,
  });

  new apigatewayv2.ApiMapping(scope, `${namingPrefix}-api-mapping`, {
    api: api,
    domainName: domainName,
    stage: api.defaultStage!,
  });
}

const createVpc = (construct: Construct, namingPrefix: string): ec2.Vpc => {
  const vpc = new ec2.Vpc(construct, `${namingPrefix}-vpc`, {
    ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/24'),
    natGateways: 1,
    subnetConfiguration: [
      {
        name: `${namingPrefix}-public-subnet-1`,
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: 28,
      },
      // {
      //   name: `${namingPrefix}-isolated-subnet-1`,
      //   subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      //   cidrMask: 28,
      // }
    ]
  });
  return vpc;
}

const createEC2Instance = (scope: Construct, vpc: ec2.Vpc, keyPairName: string, namingPrefix: string): ec2.Instance => {
  const ec2SG = new ec2.SecurityGroup(scope, `${namingPrefix}-ec2-sec-group`, {
    vpc: vpc,
    securityGroupName: `${namingPrefix}-ec2-security-group`
  });

  ec2SG.addIngressRule(
    ec2.Peer.anyIpv4(),
    ec2.Port.tcp(22),
    'Allow SSH Connections.'
  );

  ec2SG.addIngressRule(
    ec2.Peer.anyIpv4(),
    ec2.Port.tcp(5000),
    'Allow API Requests.'
  );

  ec2SG.addIngressRule(
    ec2.Peer.anyIpv4(),
    ec2.Port.tcp(443),
    'Allow HTTPS Requests.'
  );

  const keyPair = ec2.KeyPair.fromKeyPairName(scope, `${namingPrefix}-key-pair`, keyPairName);

  const ec2IAMRole = new iam.Role(scope, `${namingPrefix}-ec2-role`, {
    assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    roleName: `${namingPrefix}-ec2-role`,
  });

  ec2IAMRole.addToPolicy(new iam.PolicyStatement({
    actions: ['secretsmanager:GetSecretValue', 'ssm:GetParameter'],
    resources: ['*'],
  }));

  const ec2Instance = new ec2.Instance(scope, `${namingPrefix}-ec2-instance`, {
    instanceName: `${namingPrefix}-ec2-instance`,
    vpc: vpc,
    vpcSubnets: {
      subnetType: ec2.SubnetType.PUBLIC,
    },
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.MICRO),
    keyPair: keyPair,
    machineImage: new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
    }),
    securityGroup: ec2SG,
    role: ec2IAMRole,
  });

  const eip = new ec2.CfnEIP(scope, `${namingPrefix}-eip`);
  const eipAssoc = new ec2.CfnEIPAssociation(scope, `${namingPrefix}-eip-assoc`, {
    allocationId: eip.attrAllocationId,
    instanceId: ec2Instance.instanceId,
  });

  // const userDataScript = readFileSync('./lib/user-data.sh', 'utf8');
  // ec2Instance.addUserData(userDataScript);

  return ec2Instance;
}

const createDBInstance = (scope: Construct, vpc: ec2.Vpc, dbUsername: string, port: number, namingPrefix: string): rds.DatabaseInstance => {
  const dbSG = new ec2.SecurityGroup(scope, `${namingPrefix}-db-sec-group`, {
    vpc: vpc,
    securityGroupName: `${namingPrefix}-db-security-group`
  });

  dbSG.addIngressRule(
    ec2.Peer.anyIpv4(),
    ec2.Port.tcp(port),
    'Allow PostgreSQL Connections.'
  );

  const dbInstance = new rds.DatabaseInstance(scope, `${namingPrefix}-rds`, {
    vpc: vpc,
    vpcSubnets: {
      subnetType: ec2.SubnetType.PUBLIC,
    },
    engine: rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_16_3,
    }),
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.BURSTABLE3,
      ec2.InstanceSize.MICRO,
    ),
    credentials: rds.Credentials.fromGeneratedSecret(dbUsername, {
      secretName: `${namingPrefix}-rds-credentials`
    }),
    multiAz: false,
    allocatedStorage: 20,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    securityGroups: [dbSG],
    instanceIdentifier: `${namingPrefix}-db`,
    port: port
  });

  return dbInstance;
}

const createS3Bucket = (scope: Construct, namingPrefix: string) => {
  const bucket = new s3.Bucket(scope, `${namingPrefix}-Bucket`, {
    accessControl: s3.BucketAccessControl.PRIVATE,
    bucketName: `${namingPrefix}-web-bucket`
  })

  return bucket;
}

const initializeOidcProvider = (scope: Construct, githubOrganisation: string, accountNumber: string, namingPrefix: string) => {
  const provider = new iam.OpenIdConnectProvider(scope, `${namingPrefix}-oidc-provider`, {
    url: 'https://token.actions.githubusercontent.com',
    clientIds: ['sts.amazonaws.com'],
  });

  const GitHubPrincipal = new iam.OpenIdConnectPrincipal(provider).withConditions(
    {
      StringLike: {
        'token.actions.githubusercontent.com:sub':
          `repo:${githubOrganisation}/*`,
      },
    }
  );

  new iam.Role(scope, `${namingPrefix}-GitHubActionsRole`, {
    assumedBy: GitHubPrincipal,
    description:
      'Role assumed by GitHub actions for CD Runners.',
    roleName: `${namingPrefix}-github-actions-role`,
    maxSessionDuration: cdk.Duration.hours(1),
    inlinePolicies: {
      CdkDeploymentPolicy: new iam.PolicyDocument({
        assignSids: true,
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['sts:AssumeRole'],
            resources: [`arn:aws:iam::${accountNumber}:role/cdk-*`],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:PutObject'],
            resources: [`arn:aws:s3:::short-term-lender-web-bucket/*`],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ec2:DescribeInstances', 'ssm:GetParameter', 'secretsmanager:GetSecretValue'],
            resources: [`*`],
          }),
        ],
      }),
    },
  });
}

const initializeCloudFrontDistribution = (scope: Construct, bucket: s3.Bucket, domainNames: string, certArn: string, namingPrefix: string) => {
  const originAccessIdentity = new OriginAccessIdentity(scope, `${namingPrefix}-origin-access-identity`);
  bucket.grantRead(originAccessIdentity);

  const cachePolicy = new CachePolicy(scope, `${namingPrefix}-cache-policy`, {
    cachePolicyName: `${namingPrefix}-cache-policy`,
    comment: 'Custom cache policy for the CloudFront distribution',
    defaultTtl: cdk.Duration.minutes(5),
    minTtl: cdk.Duration.minutes(1),
    maxTtl: cdk.Duration.minutes(5),
    cookieBehavior: CacheCookieBehavior.none(),
    headerBehavior: CacheHeaderBehavior.none(),
    queryStringBehavior: CacheQueryStringBehavior.none()
  });

  new Distribution(scope, `${namingPrefix}-admin-page-distribution`, {
    domainNames: [domainNames],
    certificate: Certificate.fromCertificateArn(scope, `${namingPrefix}-admin-cert`, certArn),
    defaultRootObject: 'index.html',
    defaultBehavior: {
      origin: new S3Origin(bucket, { originAccessIdentity }),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cachePolicy
    },
  });
}

const initializeApiCloudFrontDistribution = (scope: Construct, ec2: ec2.Instance, domainNames: string, certArn: string, namingPrefix: string) => {
  const origin = new HttpOrigin(`${ec2.instancePublicDnsName}`, {
    protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
    httpPort: 5000,
  });

  const cachePolicy = new CachePolicy(scope, `${namingPrefix}-api-cache-policy`, {
    defaultTtl: cdk.Duration.seconds(0),
    maxTtl: cdk.Duration.seconds(0),
    minTtl: cdk.Duration.seconds(0),
    cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    headerBehavior: cloudfront.CacheHeaderBehavior.none(),
    cachePolicyName: `${namingPrefix}-api-cache-policy`,
    comment: 'API Cache Policy',
  });

  const originRequestPolicy = new cloudfront.OriginRequestPolicy(scope, `${namingPrefix}-api-origin-request-policy`, {
    queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
    cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
    headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
    comment: 'API Origin Request Policy',
  });

  new cloudfront.Distribution(scope, `${namingPrefix}-api-distribution`, {
    defaultBehavior: {
      origin: origin,
      cachePolicy: cachePolicy,
      compress: true,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      originRequestPolicy: {
        originRequestPolicyId: originRequestPolicy.originRequestPolicyId,
      },
    },
  });
}

const initializeCognito = (scope: Construct, namingPrefix: string, frontEndDomain: string) => {
  const tpbUserPool = new cognito.UserPool(scope, `${namingPrefix}-user-pool`, {
    userPoolName: `${namingPrefix}-user-pool`,
    selfSignUpEnabled: true,
    signInAliases: {
      email: true,
    },
    autoVerify: {
      email: true,
    },
    standardAttributes: {
      givenName: {
        required: true,
        mutable: true,
      },
      familyName: {
        required: true,
        mutable: true,
      }
    },
    passwordPolicy: {
      minLength: 8,
      requireLowercase: true,
      requireDigits: true,
      requireUppercase: false,
      requireSymbols: false,
    },
    accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });

  const standardCognitoAttributes = {
    givenName: true,
    familyName: true,
    email: true,
    emailVerified: true,
    address: true,
    birthdate: true,
    gender: true,
    phoneNumber: true,
    phoneNumberVerified: true,
    profilePicture: true,
    preferredUsername: true,
    timezone: true,
    lastUpdateTime: true,
  };

  const clientReadAttributes = new cognito.ClientAttributes().withStandardAttributes(standardCognitoAttributes);
  const clientWriteAttributes = new cognito.ClientAttributes().withStandardAttributes(
    {
      ...standardCognitoAttributes,
      emailVerified: false,
      phoneNumberVerified: false
    }
  );

  const userPoolClient = new cognito.UserPoolClient(scope, `${namingPrefix}-user-pool-client`, {
    userPool: tpbUserPool,
    authFlows: {
      custom: true,
      userSrp: true
    },
    supportedIdentityProviders: [
      cognito.UserPoolClientIdentityProvider.COGNITO,
    ],
    readAttributes: clientReadAttributes,
    writeAttributes: clientWriteAttributes,
    oAuth: {
      callbackUrls: [`https://${frontEndDomain}`, 'http://localhost:5500', 'https://localhost:5500'],
      logoutUrls: [`https://${frontEndDomain}`, 'http://localhost:5500', 'https://localhost:5500']
    }
  });
}