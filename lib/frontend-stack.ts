import {RemovalPolicy, Stack, StackProps} from "aws-cdk-lib";
import {Construct} from "constructs";
import {BlockPublicAccess, Bucket} from "aws-cdk-lib/aws-s3";
import {ManagedPolicy} from "aws-cdk-lib/aws-iam";
import {
    BuildEnvironmentVariableType,
    BuildSpec,
    EventAction,
    FilterGroup,
    LinuxBuildImage,
    Project,
    Source
} from "aws-cdk-lib/aws-codebuild";
import {createCodeBuildProjectPolicy} from "./util";

interface FrontendStackProps extends StackProps {
    frontendBucketName: string,
    serverCodeBuildProject: Project
}

export class FrontendStack extends Stack {
    constructor(scope: Construct, id: string, props: FrontendStackProps) {
        super(scope, id, props);

        const frontendBucket = this.createFrontendBucket(props.frontendBucketName);
        this.createCodebuildProject(frontendBucket, props.serverCodeBuildProject);
    }

    private createFrontendBucket(bucketName: string) {
        return new Bucket(this, 'FrontendBucket', {
            bucketName: bucketName,
            publicReadAccess: false,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true
        });
    }


    private createCodebuildProject(frontendBucket: Bucket, serverCodeBuildProject: Project) {
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
                privileged: true,
                environmentVariables: {
                    "ASSET_BUCKET_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: frontendBucket.bucketName
                    },
                    "SERVER_PROJECT_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: serverCodeBuildProject.projectName
                    }
                }
            },
            buildSpec: BuildSpec.fromSourceFilename("./buildspec.yml"),
        });

        frontendCodebuildProject.role?.attachInlinePolicy(createCodeBuildProjectPolicy(this));
        frontendCodebuildProject.role?.addManagedPolicy(ManagedPolicy.fromManagedPolicyArn(this,
            "Cloudfront-Policy", "arn:aws:iam::aws:policy/CloudFrontFullAccess"));
        frontendCodebuildProject.role?.addManagedPolicy(ManagedPolicy.fromManagedPolicyArn(this,
            "S3-Policy", "arn:aws:iam::aws:policy/AmazonS3FullAccess"));

    }
}