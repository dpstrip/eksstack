import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as s3Assets from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';
import { KubectlV23Layer } from '@aws-cdk/lambda-layer-kubectl-v23';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as rds from 'aws-cdk-lib/aws-rds';

export class EksstackStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, 'vpc', {
      vpcId: 'vpc-0b3e718e0d3a7b733',
    })
    
  /******************************************************/
  /*** Create the bastion server                    *****/
  /******************************************************/
  const asset = new s3Assets.Asset(this, 'S3Asset', {
    path: 'assets/kubectl'
  });

  const userData = ec2.UserData.forLinux();
  userData.addS3DownloadCommand({
    bucket: asset.bucket,
    bucketKey: asset.s3ObjectKey,
    localFile: '/tmp/kubectl'
  });
  userData.addCommands(
    'chmod +x /tmp/kubectl',
    'cp /tmp/kubectl /usr/local/bin'
  );

  const securityGroup = new ec2.SecurityGroup(this, 'web-server-sg', {
    vpc,
    allowAllOutbound: true,
    description: 'security group for a web server',
  });

  securityGroup.addIngressRule(
    ec2.Peer.ipv4('3.83.200.219/32'),
    ec2.Port.tcp(22),
  );

  securityGroup.addIngressRule(
    ec2.Peer.ipv4('3.83.200.219/32'),
    ec2.Port.tcp(80),
  );

  const host = new ec2.BastionHostLinux(this, 'Bastion', { 
    vpc,
    requireImdsv2: true,
    securityGroup,
    machineImage: ec2.MachineImage.latestAmazonLinux({ 
      userData,
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
    })
  });

  host.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'));
    
    
  /******************************************************/
  /*** Create the efs service                       *****/
  /******************************************************/
     //create efs within the vpc
    const efsSecurityGroup = new ec2.SecurityGroup(this, 'efs-sg',{
      vpc,
      allowAllOutbound: true,
      description: 'security group for efs'
    });
    
    const fileSytem = new efs.FileSystem(this, "MyEfsFileSystem",{
      vpc,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      securityGroup: efsSecurityGroup,
    });
    
    //create a volumn
    const volume = { name: "volumn",
      efsVolumnConfiguration: {
        fileSystemId: fileSytem.fileSystemId
      }
    };
    
  /******************************************************/
  /*** Create the rds service                       *****/
  /******************************************************/
    //Create the rds instance
  const dbInstance = new rds.DatabaseInstance(this, 'db-instance',{
    vpc,
    vpcSubnets:{
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    },
    engine: rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_14,
    }),
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.BURSTABLE3,
      ec2.InstanceSize.MICRO,
      ),
    credentials: rds.Credentials.fromGeneratedSecret('postgres'),
    multiAz: false,
    allocatedStorage: 100,
    maxAllocatedStorage: 110,
    allowMajorVersionUpgrade: false,
    autoMinorVersionUpgrade: true,
    backupRetention: cdk.Duration.days(0),
    deleteAutomatedBackups: true,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    deletionProtection: false,
    databaseName: 'todosdb',
    publiclyAccessible: false
  });
  
  //dbInstance.connections.allowFrom(ec2Instance, ec2.Port.tcp(5432));
  
  new cdk.CfnOutput(this, 'dbEndpoint',
  {
    value:dbInstance.instanceEndpoint.hostname,
  });
  
  new cdk.CfnOutput(this, 'secretName', {
    value: dbInstance.secret?.secretName!,
  });
    
    //cluster
    const cluster = new eks.Cluster(this, 'Cluster', {
      vpc,
      defaultCapacity: 1,
      placeClusterHandlerInVpc: true,
      version: eks.KubernetesVersion.V1_23,
      endpointAccess: eks.EndpointAccess.PRIVATE,
      vpcSubnets: [{ 
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      }],
      kubectlEnvironment: {
          // use vpc endpoint, not the global
          "AWS_STS_REGIONAL_ENDPOINTS": 'regional'
      },
      kubectlLayer: new KubectlV23Layer(this, 'kubectl')
    });
    
    const policy = iam.ManagedPolicy.fromAwsManagedPolicyName(
      'AmazonEC2ContainerRegistryReadOnly');
    cluster.role.addManagedPolicy(policy);

    cluster.awsAuth.addMastersRole(iam.Role.fromRoleArn(this,'mastersrole', 'arn:aws:iam::368905307904:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_AWSAdministratorAccess_bc229288474a4d46'))

     const role = iam.Role.fromRoleArn(this, 'adminrole', 'arn:aws:sts::368905307904:assumed-role/AWSReservedSSO_AWSAdministratorAccess_bc229288474a4d46/cailin.touseull.sparx@stls.frb.org')
     cluster.awsAuth.addRoleMapping(role, { groups: [ 'system:masters' ]});
  }
}
