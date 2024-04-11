import * as cdk from 'aws-cdk-lib';
import {RemovalPolicy, Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {
    BuildEnvironmentVariableType,
    BuildSpec,
    EventAction,
    FilterGroup,
    LinuxBuildImage,
    Project,
    Source
} from "aws-cdk-lib/aws-codebuild";
import {Repository} from "aws-cdk-lib/aws-ecr";
import {Cluster, ContainerImage, Ec2Service, Ec2TaskDefinition, NetworkMode, Protocol} from "aws-cdk-lib/aws-ecs";
import {InstanceType, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {
    ApplicationLoadBalancer,
    ApplicationProtocol,
    ApplicationTargetGroup,
    TargetType
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {createCodeBuildProjectPolicy} from "./util";

// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class ServerStack extends Stack {

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const vpc = this.createVPC();
        const ecrRepo = this.createECRRepo();

        const cluster = this.createCluster(vpc);
        const ecsService = this.createService(ecrRepo, cluster);
        const loadBalancer = this.createLoadBalancer(vpc);

        const targetGroup = this.createTargetGroup(vpc, ecsService);

        loadBalancer.addListener('ServerListener', {
            port: 80,
            protocol: ApplicationProtocol.HTTP,
            defaultTargetGroups: [targetGroup]
        });

        const project = this.createCodebuildProject(cluster, ecsService);
        ecrRepo.grantPullPush(project);

    }

    private createCodebuildProject(cluster: Cluster, ecsService: Ec2Service) {
        const source = Source.gitHub({
            owner: 'knk190001',
            repo: 'CS-4485-Team-45-Server',
            webhook: true,
            webhookTriggersBatchBuild: false,
            webhookFilters: [
                FilterGroup.inEventOf(EventAction.PUSH).andBranchIs('master')
            ]
        });

        const project = new Project(this, 'ServerCodeBuildProject', {
            source,
            environment: {
                buildImage: LinuxBuildImage.STANDARD_6_0,
                privileged: true,
                environmentVariables: {
                    "CLUSTER_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: cluster.clusterName
                    },
                    "SERVICE_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: ecsService.serviceName
                    }
                }
            },
            buildSpec: BuildSpec.fromSourceFilename('buildspec.yml'),
        });

        const policy = createCodeBuildProjectPolicy(this);
        project.role?.attachInlinePolicy(policy);

        return project;
    }


    private createECRRepo() {
        return new Repository(this, 'ServerECRRepo', {
            removalPolicy: RemovalPolicy.DESTROY,
            repositoryName: 'server-image-repo',
            emptyOnDelete: true
        });
    }

    private createService(ecrRepo: Repository, cluster: Cluster) {
        const taskDefinition = this.createTaskDefinition(ecrRepo);

        return new Ec2Service(this, 'Ec2Service', {
            cluster,
            taskDefinition,
            desiredCount: 1,
            maxHealthyPercent: 100,
            minHealthyPercent: 0,
            circuitBreaker: {
                enable: false,
                rollback: false,
            },
        });
    }

    private createCluster(vpc: Vpc) {
        const cluster = new Cluster(this, 'Cluster', {vpc});
        cluster.addCapacity("DefaultAutoScalingCapacity", {
            instanceType: new InstanceType("t2.micro"),
            desiredCapacity: 1,
            allowAllOutbound: true,
            associatePublicIpAddress: true,
            vpcSubnets: {
                subnetType: SubnetType.PUBLIC
            }
        });

        return cluster;
    }

    private createTaskDefinition(ecrRepo: Repository) {
        const taskDefinition = new Ec2TaskDefinition(this, 'ServerTaskDefinition', {
            networkMode: NetworkMode.HOST
        });

        taskDefinition.addContainer("DefaultContainer", {
            image: ContainerImage.fromEcrRepository(ecrRepo, "latest"),
            portMappings: [
                {
                    containerPort: 80,
                    protocol: Protocol.TCP
                }
            ],
            memoryLimitMiB: 400,
            healthCheck: {
                command: ["CMD-SHELL", "curl -f http://localhost/actuator/health || exit 1"]
            },
        });

        return taskDefinition;
    }

    private createVPC() {
        return new Vpc(this, "Vpc", {
            subnetConfiguration: [
                {
                    subnetType: SubnetType.PUBLIC,
                    name: 'PublicSubnet',
                },
                {
                    subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                    name: 'PrivateSubnet',
                },
            ],
        });
    }

    private createLoadBalancer(vpc: Vpc) {
        return new ApplicationLoadBalancer(this, 'ALB', {
            vpc,
            internetFacing: true
        });
    }

    private createTargetGroup(vpc: Vpc, ecsService: Ec2Service) {
        return new ApplicationTargetGroup(this, 'TargetGroup', {
            port: 80,
            vpc,
            protocol: ApplicationProtocol.HTTP,
            healthCheck: {
                path: '/actuator/health',
            },
            targetType: TargetType.INSTANCE,
            targets: [ecsService.loadBalancerTarget({
                containerName: 'DefaultContainer',
                containerPort: 80
            })]
        });
    }
}
