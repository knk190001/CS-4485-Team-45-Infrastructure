import {CfnOutput, Duration, RemovalPolicy, Stack, StackProps} from 'aws-cdk-lib';
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
import {
    AwsLogDriverMode,
    Cluster,
    ContainerImage,
    Ec2Service,
    Ec2TaskDefinition,
    LogDriver,
    NetworkMode,
    Protocol
} from "aws-cdk-lib/aws-ecs";
import {InstanceType, SecurityGroup, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {
    ApplicationLoadBalancer,
    ApplicationProtocol,
    ApplicationTargetGroup,
    TargetType
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {createCodeBuildProjectPolicy} from "./util";
import {DatabaseInstance, DatabaseInstanceEngine, IDatabaseInstance} from "aws-cdk-lib/aws-rds";
import {Effect, Policy, PolicyStatement} from "aws-cdk-lib/aws-iam";

interface DBArgs {
    instanceEndpointAddress: string,
    instanceResourceId: string,
    instanceIdentifier: string,
    securityGroupIds: string[],
    dbUsername: string
}

interface ServerStackProps extends StackProps {
    frontendBucketName: string,
    dbArgs: DBArgs
}

export class ServerStack extends Stack {
    serverCodeBuildProject: Project;

    constructor(scope: Construct, id: string, props: ServerStackProps) {
        super(scope, id, props);

        const vpc = this.createVPC();
        const ecrRepo = this.createECRRepo();

        const cluster = this.createCluster(vpc);
        const ecsService = this.createService(ecrRepo, cluster, props.dbArgs);
        const loadBalancer = this.createLoadBalancer(vpc);

        const targetGroup = this.createTargetGroup(vpc, ecsService);

        loadBalancer.addListener('ServerListener', {
            port: 80,
            protocol: ApplicationProtocol.HTTP,
            defaultTargetGroups: [targetGroup]
        });

        this.serverCodeBuildProject = this.createCodebuildProject(cluster, ecsService, props.frontendBucketName);
        ecrRepo.grantPullPush(this.serverCodeBuildProject);

        new CfnOutput(this, "ALB Url", {
            key: "ALBUrl",
            value: loadBalancer.loadBalancerDnsName
        });
    }

    private createCodebuildProject(cluster: Cluster, ecsService: Ec2Service, frontendBucketName: string) {
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
                    },
                    "STATIC_BUCKET_NAME": {
                        type: BuildEnvironmentVariableType.PLAINTEXT,
                        value: frontendBucketName
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

    private createService(ecrRepo: Repository, cluster: Cluster, dbArgs: DBArgs) {
        const taskDefinition = this.createTaskDefinition(ecrRepo, dbArgs);

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

    private createTaskPolicy(db: IDatabaseInstance, dbUsername: string) {
        const policyStatement = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "rds-db:connect"
            ],
            resources: [`arn:aws:rds-db:${this.region}:${this.account}:dbuser:${db.instanceResourceId}/${dbUsername}`]
        });
        return new Policy(this, 'TaskPolicy', {
            statements: [policyStatement]
        });
    }

    private importDB(dbArgs: DBArgs) {
        const {instanceEndpointAddress, instanceIdentifier, securityGroupIds, instanceResourceId} = dbArgs
        const securityGroups = securityGroupIds.map((id) => {
            return SecurityGroup.fromLookupById(this, `DBSecurityGroup-${id}`, id)
        });

        return DatabaseInstance.fromDatabaseInstanceAttributes(
            this,
            "Database",
            {
                port: 3306,
                instanceEndpointAddress,
                instanceIdentifier,
                securityGroups: securityGroups,
                engine: DatabaseInstanceEngine.MYSQL,
                instanceResourceId
            }
        );
    }

    private createTaskDefinition(ecrRepo: Repository, dbArgs: DBArgs) {
        const taskDefinition = new Ec2TaskDefinition(this, 'ServerTaskDefinition', {
            networkMode: NetworkMode.HOST
        });
        const db = this.importDB(dbArgs);

        taskDefinition.taskRole.attachInlinePolicy(this.createTaskPolicy(db, dbArgs.dbUsername));
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
            environment: {
                "DB_HOST_NAME": db.dbInstanceEndpointAddress,
                "DB_PORT": db.dbInstanceEndpointPort,
                "DB_USERNAME": "server"
            },
            logging: LogDriver.awsLogs({
                streamPrefix:"server",
                mode: AwsLogDriverMode.NON_BLOCKING,
            }),

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
            internetFacing: true,
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
            })],
            deregistrationDelay: Duration.seconds(20)
        });
    }
}
