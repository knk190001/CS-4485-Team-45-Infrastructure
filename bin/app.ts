#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {ServerStack} from '../lib/server-stack';
import {FrontendStack} from "../lib/frontend-stack";

const env = {
    region: 'us-west-2',
    account: '533266981808'
}

const app = new cdk.App();
const frontendBucketName = `frontend-bucket-${env.account}`
const serverStack = new ServerStack(app, 'InfrastructureStack', {env, frontendBucketName});
new FrontendStack(app, 'FrontendStack', {
    env,
    frontendBucketName,
    serverCodeBuildProject: serverStack.serverCodeBuildProject
});
