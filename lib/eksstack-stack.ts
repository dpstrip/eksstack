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
      vpcId: 'vpc-0ad625f9f9134af25',
    })
    
  /******************************************************/
  /*** Create the bastion server                    *****/
  /******************************************************/
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
  
 
  
  securityGroup.addIngressRule(
    ec2.Peer.ipv4('3.83.200.219/32'),
    ec2.Port.tcp(443),
  ); //trying to get access into server
     [
        ec2.InterfaceVpcEndpointAwsService.AUTOSCALING,
        ec2.InterfaceVpcEndpointAwsService.CLOUDFORMATION,
        ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,      
        ec2.InterfaceVpcEndpointAwsService.ECR,
        ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
        ec2.InterfaceVpcEndpointAwsService.ELASTIC_LOAD_BALANCING,
        ec2.InterfaceVpcEndpointAwsService.KMS,
        ec2.InterfaceVpcEndpointAwsService.LAMBDA,
        ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS,
        ec2.InterfaceVpcEndpointAwsService.STS,
       
     ec2.InterfaceVpcEndpointAwsService.EC2,
     ec2.InterfaceVpcEndpointAwsService.SSM,
     ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
     ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES
     ].forEach(e=> vpc.addInterfaceEndpoint(e.shortName,{service: e, securityGroups:[securityGroup]}));
     
  
  
  
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
  host.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
  
  /****************************************************/
  /*******   create a ec2 in public             *******/
  /****************************************************/
   /*Create a security groups and there rules*/
      const webSG = new ec2.SecurityGroup(this, 'my-ec2-public-access',{
        vpc,
        allowAllOutbound: true,
        description: 'security group for public web access'
      });
      /* create security Group for it */
      webSG.addIngressRule(
        ec2.Peer.ipv4('3.83.200.219/32'),
        ec2.Port.tcp(22),
        'allow SSH access from anywhere');
        
      webSG.addIngressRule(
       ec2.Peer.ipv4('3.83.200.219/32'),
        ec2.Port.tcp(80),
        'allow HTTP access from anywhere');
      
      webSG.addIngressRule(
       ec2.Peer.ipv4('3.83.200.219/32'),
        ec2.Port.tcp(443),
        'allow HTTPS access from anywhere');
        
         /* Create an IAM role and a server to to put into the public subnet */
        
        const publicserviceRole = new iam.Role(this, "publicserver-role",{
          assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
          managedPolicies:[
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess')],
        });
  
  const ec2PublicInstance = new ec2.Instance(this, 'my-stack-ec2-instance', {
        vpc,
        vpcSubnets:{
          subnetType: ec2.SubnetType.PUBLIC,
        },
        role: publicserviceRole,
        securityGroup: webSG,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.BURSTABLE2,
          ec2.InstanceSize.MICRO
          ),
          machineImage: new ec2.AmazonLinuxImage({
            generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,})
          });
          
        ec2PublicInstance.role.addManagedPolicy(
          iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'));
    
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
    
    fileSytem.connections.allowDefaultPortFrom(host);
    
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
  
 dbInstance.connections.allowFrom(host, ec2.Port.tcp(5432));
 dbInstance.connections.allowFrom(ec2PublicInstance, ec2.Port.tcp(5432));
 
    dbInstance.connections.allowFrom(
      new ec2.Connections({securityGroups:[securityGroup],}),
      ec2.Port.tcp(5432),
      'connect from a puiblic SG'
      );
  
  new cdk.CfnOutput(this, 'dbEndpoint',
  {
    value:dbInstance.instanceEndpoint.hostname,
  });
  
  new cdk.CfnOutput(this, 'secretName', {
    value: dbInstance.secret?.secretName!,
  });
    
    
  /******************************************************/
  /*** Create the EKS service                       *****/
  /******************************************************/
    //cluster
    /*
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

    cluster.awsAuth.addMastersRole(iam.Role.fromRoleArn(this,'mastersrole', `arn:aws:iam::${cdk.Stack.of(this).account}:role/Existing-Role-Name`,));

     const role = iam.Role.fromRoleArn(this, 'adminrole', `arn:aws:iam::${cdk.Stack.of(this).account}:role/Existing-Role-Name`,);
     cluster.awsAuth.addRoleMapping(role, { groups: [ 'system:masters' ]});
     */
  }
}
