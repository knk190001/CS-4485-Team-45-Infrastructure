#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ServerStack } from '../lib/server-stack';
import {FrontendStack} from "../lib/frontend-stack";

const env = {
    region: 'us-west-2',
    account: '533266981808'
}

const app = new cdk.App();
new ServerStack(app, 'InfrastructureStack', { env });
new FrontendStack(app, 'FrontendStack', { env });
