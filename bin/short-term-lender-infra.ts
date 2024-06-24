#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ShortTermLenderInfraStack } from '../lib/short-term-lender-infra-stack';

const app = new cdk.App();
new ShortTermLenderInfraStack(app, 'ShortTermLenderInfraStack', {
  namingPrefix: 'short-term-lender',
  ghOrgName: 'bbd-miniconomy-short-term-lender',
  ec2KeyPairName: '',
  dbUsername: 'lonelyloner',
  dbPort: 31415,
  frontEndDomain: 'loans.projects.bbdgrad.com',
  frontEndCertArn: '',
  apiDomain: 'api.loans.projects.bbdgrad.com',
  apiCertArn: '',
});