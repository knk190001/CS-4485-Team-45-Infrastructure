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
const serverStack = new ServerStack(app, 'InfrastructureStack', {
    env,
    frontendBucketName,
    dbArgs: {
        dbUsername: 'server',
        securityGroupIds: [
            'sg-0298135b78b61ee04',
            'sg-01468554c0d549426',
            'sg-0c9a850a91b788ff3'
        ],
        instanceIdentifier: 'main-db',
        instanceEndpointAddress: 'main-db.cx84qm2oykjx.us-west-2.rds.amazonaws.com',
        instanceResourceId: 'db-LACHMJY73SGPB6OBGVN4DJKZG4'
    }
});
new FrontendStack(app, 'FrontendStack', {
    env,
    frontendBucketName,
    serverCodeBuildProject: serverStack.serverCodeBuildProject
});
