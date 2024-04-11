import {Effect, Policy, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Construct} from "constructs";

export function createCodeBuildProjectPolicy(scope: Construct) {
    const policyStatement = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
            "ec2:CreateNetworkInterface",
            "ec2:DescribeDhcpOptions",
            "ec2:DescribeNetworkInterfaces",
            "ec2:DeleteNetworkInterface",
            "ec2:DescribeSubnets",
            "ec2:DescribeSecurityGroups",
            "ec2:DescribeVpcs",
            "ecs:UpdateService"
        ],
        resources: ["*"]
    });
    return new Policy(scope, 'ServerProjectPolicy', {
        statements: [policyStatement]
    });
}