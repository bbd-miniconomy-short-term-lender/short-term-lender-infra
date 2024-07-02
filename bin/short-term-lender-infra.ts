#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ShortTermLenderInfraStack } from '../lib/short-term-lender-infra-stack';

const app = new cdk.App();
new ShortTermLenderInfraStack(app, 'ShortTermLenderInfraStack', {
  namingPrefix: 'short-term-lender',
  ghOrgName: 'bbd-miniconomy-short-term-lender',
  ec2KeyPairName: 'short-term-lender-ec2-key',
  dbUsername: 'lonelyloner',
  dbPort: 31415,
  frontEndDomain: 'loans.projects.bbdgrad.com',
  frontEndCertArn: 'arn:aws:acm:us-east-1:680901290385:certificate/e1b4dc3b-a0a3-4a49-9752-8c5fe5aca29a',
  apiDomain: 'api.loans.projects.bbdgrad.com',
  apiCertArn: 'arn:aws:acm:eu-west-1:680901290385:certificate/2d0201e9-9bc5-474a-9f3a-b16dcc880e27',
  configParamName: '/stl/config',
  mTlsBucketName: 'miniconomy-trust-store-bucket',
  mTlsPemPath: 'truststore.pem',
});