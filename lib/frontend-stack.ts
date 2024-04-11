import {CfnOutput, RemovalPolicy, Stack, StackProps} from "aws-cdk-lib";
import {Construct} from "constructs";
import {AllowedMethods, Distribution, OriginAccessIdentity, ViewerProtocolPolicy} from "aws-cdk-lib/aws-cloudfront";
import {BlockPublicAccess, Bucket} from "aws-cdk-lib/aws-s3";
import {CanonicalUserPrincipal, ManagedPolicy, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {S3Origin} from "aws-cdk-lib/aws-cloudfront-origins";
import {BuildSpec, EventAction, FilterGroup, LinuxBuildImage, Project, Source} from "aws-cdk-lib/aws-codebuild";
import {createCodeBuildProjectPolicy} from "./util";

export class FrontendStack extends Stack {
    constructor(scope: Construct, id: string, props: StackProps) {
        super(scope, id, props);

        const cloudfrontOAI = new OriginAccessIdentity(this, 'CloudFront-OAI');
        const frontendBucket = this.createFrontendBucket(<string>props.env?.account);
        this.grantS3AccessToCloudFront(frontendBucket, cloudfrontOAI);

        const distribution = this.createDistribution(frontendBucket, cloudfrontOAI);
        this.createCodebuildProject(frontendBucket, distribution);
    }

    private createFrontendBucket(accountId: string) {
        return new Bucket(this, 'FrontendBucket', {
            bucketName: `frontend-bucket-${accountId}`,
            publicReadAccess: false,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true
        });
    }

    private grantS3AccessToCloudFront(frontendBucket: Bucket, cloudfrontOAI: OriginAccessIdentity) {
        frontendBucket.addToResourcePolicy(
            new PolicyStatement({
                actions: ['s3:GetObject'],
                resources: [frontendBucket.arnForObjects('*')],
                principals: [new CanonicalUserPrincipal(cloudfrontOAI.cloudFrontOriginAccessIdentityS3CanonicalUserId)]
            })
        );
    }

    private createDistribution(frontendBucket: Bucket, cloudfrontOAI: OriginAccessIdentity) {
        const distribution = new Distribution(this, "FrontendDistribution", {
            defaultRootObject: "index.html",
            defaultBehavior: {
                origin: new S3Origin(frontendBucket, {originAccessIdentity: cloudfrontOAI}),
                compress: true,
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: ViewerProtocolPolicy.ALLOW_ALL
            }
        });

        new CfnOutput(this, `DistributionUrl`, {
            value: distribution.distributionDomainName
        });
        return distribution;
    }

    private createCodebuildProject(frontendBucket: Bucket, distribution: Distribution) {
        const source = Source.gitHub({
            owner: 'knk190001',
            repo: 'CS-4485-Team-45-Frontend',
            webhook: true,
            webhookTriggersBatchBuild: false,
            webhookFilters: [
                FilterGroup.inEventOf(EventAction.PUSH).andBranchIs("master")
            ]
        });

        const frontendCodebuildProject = new Project(this, 'FronendCodebuildProject', {
            source: source,
            environment: {
                buildImage: LinuxBuildImage.STANDARD_6_0,
                privileged: true
            },
            buildSpec: FrontendStack.getBuildSpec(frontendBucket, distribution),
        });

        frontendCodebuildProject.role?.attachInlinePolicy(createCodeBuildProjectPolicy(this));
        frontendCodebuildProject.role?.addManagedPolicy(ManagedPolicy.fromManagedPolicyArn(this,
            "Cloudfront-Policy", "arn:aws:iam::aws:policy/CloudFrontFullAccess"));
        frontendCodebuildProject.role?.addManagedPolicy(ManagedPolicy.fromManagedPolicyArn(this,
            "S3-Policy", "arn:aws:iam::aws:policy/AmazonS3FullAccess"));

    }

    private static getBuildSpec(frontendBucket: Bucket, distribution: Distribution) {
        return BuildSpec.fromObjectToYaml({
            version: '0.2',
            phases: {
                pre_build: {
                    commands: [
                        'npm ci'
                    ]
                },

                build: {
                    commands: ['npm run build']
                },

                post_build: {
                    commands: [
                        'echo Clearing distribution bucket',
                        `aws s3 rm s3://${frontendBucket.bucketName}/ --recursive`,
                        'echo Uploading artifacts',
                        `aws s3 cp ./dist s3://${frontendBucket.bucketName} --recursive`,
                        'echo Invalidating distribution',
                        `aws cloudfront create-invalidation --distribution-id ${distribution.distributionId} --paths '/*'`,
                    ]
                }
            }
        });
    }
}