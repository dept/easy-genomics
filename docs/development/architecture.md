# Easy Genomics — Platform Architecture

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [AWS Infrastructure](#3-aws-infrastructure)
4. [Back-End: CDK Stacks](#4-back-end-cdk-stacks)
5. [Back-End: Lambda Domains](#5-back-end-lambda-domains)
6. [Services Layer](#6-services-layer)
7. [Async Event Architecture](#7-async-event-architecture)
8. [Front-End Architecture](#8-front-end-architecture)
9. [Authentication Flow](#9-authentication-flow)
10. [Key Data Flows](#10-key-data-flows)
11. [Data Model](#11-data-model)
12. [CI/CD Pipeline](#12-cicd-pipeline)
13. [Local Development Architecture](#13-local-development-architecture)
14. [Configuration System](#14-configuration-system)

---

## 1. Platform Overview

Easy Genomics is a multi-tenant web application that simplifies genomic analysis for bioinformaticians. It acts as a
unified control plane over two genomics compute platforms:

- **AWS HealthOmics** — managed genomics workflows (Nextflow, WDL)
- **Seqera Tower (nf-tower)** — Nextflow pipeline orchestration

**Key concepts:**

| Concept             | Description                                                                          |
| ------------------- | ------------------------------------------------------------------------------------ |
| **Organization**    | Top-level tenant. Groups laboratories and users.                                     |
| **Laboratory**      | A workspace within an org. Has its own S3 bucket, users, and workflow access.        |
| **User Roles**      | System Admin → Org Admin → Lab Manager → Lab Technician                              |
| **Run**             | A single workflow/pipeline execution tied to a Laboratory.                           |
| **Workflow Access** | Per-laboratory allowlist controlling which HealthOmics/Seqera workflows are visible. |

**Technology stack:**

| Layer          | Technology                                |
| -------------- | ----------------------------------------- |
| Front-End      | Nuxt 3 / Vue 3, Pinia, Tailwind CSS       |
| Back-End       | AWS Lambda (TypeScript), API Gateway REST |
| Infrastructure | AWS CDK (TypeScript) / CloudFormation     |
| Database       | DynamoDB                                  |
| Auth           | AWS Cognito + JWT                         |
| Messaging      | SQS (FIFO)                                |
| Storage        | S3                                        |
| Email          | SES                                       |
| Monorepo       | NX + PNPM workspaces + Projen             |

---

## 2. High-Level Architecture

```mermaid
graph TB
    subgraph "User's Browser"
        FE["Nuxt 3 SPA<br/>(Vue 3 + Pinia)"]
    end

    subgraph "AWS — Front-End"
        CF["CloudFront CDN"]
        S3FE["S3 Static Hosting"]
        CF --> S3FE
    end

    subgraph "AWS — Auth"
        COG["Cognito User Pool"]
    end

    subgraph "AWS — Back-End"
        APIGW["API Gateway REST API"]

        subgraph "Lambda Controllers"
            EG["easy-genomics<br/>domain (100+ handlers)"]
            OH["aws-healthomics<br/>(13 handlers)"]
            NF["nf-tower<br/>(13 handlers)"]
            AU["auth triggers<br/>(4 handlers)"]
        end

        subgraph "Async Layer"
            SQS["SQS FIFO Queues"]
            STR["DynamoDB Streams"]
        end

        subgraph "Storage"
            DDB["DynamoDB<br/>(11 easy-genomics tables<br/>+ workflow-schema + auth-log)"]
            S3["S3 Lab Buckets"]
        end

        subgraph "External Platforms"
            HO["AWS HealthOmics"]
            ST["Seqera Tower API"]
        end
    end

    FE -->|"HTTPS (CloudFront URL)"| CF
    FE -->|"Auth (Cognito Hosted UI / SDK)"| COG
    FE -->|"REST + JWT"| APIGW
    APIGW --> EG & OH & NF
    COG -->|"triggers"| AU
    EG & OH & NF --> DDB & S3
    EG -->|"direct publish"| SQS
    DDB -->|"laboratory-run-table"| STR
    SQS -->|"event source"| EG
    STR -->|"event source"| EG
    OH --> HO
    NF --> ST
```

Direct publish to SQS replaced a former SNS → SQS hop; each topic had exactly one subscriber, so the SNS layer was
collapsed to save resources. `sns-service.ts` and `sns-construct.ts` remain in the codebase but are unused by any
current stack.

---

## 3. AWS Infrastructure

```mermaid
graph TB
    subgraph "VPC  10.11.0.0/16"
        subgraph "Public Subnets /27"
            PUB["NAT Gateway"]
        end
        subgraph "Private Subnets /20"
            LAM["Lambda Functions"]
        end
        EP1[("DynamoDB<br/>Gateway Endpoint")]
        EP2[("S3<br/>Gateway Endpoint")]
    end

    subgraph "Global / Regional"
        direction LR
        COG["Cognito<br/>User Pool"]
        KMS["KMS Key<br/>(Cognito encryption)"]
        APIGW["API Gateway<br/>REST (Regional)<br/>100 RPS / 1000 day"]
        SES["SES<br/>(Email Templates)"]
        SM["Secrets Manager<br/>(GitHub PAT)"]
        SSM["SSM Parameter Store<br/>(Seqera access tokens)"]
        EB["EventBridge<br/>(HealthOmics tag events)"]
    end

    subgraph "Storage"
        direction LR
        DDB1["organization-table"]
        DDB2["laboratory-table"]
        DDB3["user-table"]
        DDB4["org-user-table"]
        DDB5["lab-user-table"]
        DDB6["lab-run-table<br/>(TTL: ExpiresAt)"]
        DDB7["unique-reference-table"]
        DDB8["lab-workflow-access-table"]
        DDB9["lab-s3-access-table"]
        DDB10["workflow-run-preset-table"]
        DDB11["workflow-schema-table<br/>(HealthOmics cache)"]
        DDB12["authentication-log-table"]
        S3LAB["S3 Lab Data Bucket<br/>{account}-{env}-lab-bucket"]
        S3FE["S3 Static Front-End"]
    end

    subgraph "Messaging"
        SQS1["organization-management-queue"]
        SQS2["laboratory-management-queue"]
        SQS3["user-management-queue"]
        SQS4["laboratory-run-update-queue"]
        SQS5["laboratory-run-failure-classification-queue"]
        SQS6["laboratory-run-notification-queue"]
        SQS7["user-invite-queue"]
        SQS8["folder-download-queue"]
    end

    subgraph "Front-End Hosting"
        CF["CloudFront Distribution<br/>(ACM cert + Route 53 in prod)"]
        CF --> S3FE
    end

    LAM --> EP1 & EP2
    LAM --> COG & SES & SM & SSM
    APIGW --> LAM
    EB -->|"github-repo-url tag change"| LAM
```

---

## 4. Back-End: CDK Stacks

All infrastructure is defined in TypeScript CDK and deployed via CloudFormation. The entry point is
`packages/back-end/src/main.ts`.

There are **two top-level stacks**, each rendered to its own CloudFormation template (each with its own 500-resource
limit). `EasyGenomicsApiStack` was split out of `BackEndStack` because the Easy Genomics route set alone pushed the
shared template past 500 resources.

```mermaid
graph TB
    MAIN["main.ts<br/>easy-genomics.yaml → BackEndApp"]

    MAIN --> BS & EGAPI

    subgraph BS["BackEndStack (top-level)"]
        VPC["VPC Construct<br/>10.11.0.0/16<br/>pub+priv subnets<br/>DDB+S3 endpoints"]
        KMS["KMS Key<br/>(Cognito passwords)"]
    end

    BS --> ANS & OHNS & NFNS

    subgraph EGAPI["EasyGenomicsApiStack (top-level, split-out)"]
        APIGW["ApiGateway Construct<br/>REST regional endpoint<br/>CORS: ALL / 100 RPS"]
        EGDB9["11 DynamoDB Tables<br/>(RETAIN + DeletionProtection + PITR,<br/>hosted at parent scope for cdk import)"]
    end

    EGAPI --> ENS & DPNS

    subgraph ANS["AuthNestedStack"]
        COG["CognitoIdp Construct<br/>User Pool + Client<br/>Domain + Google OAuth"]
        COTRIG["Lambda Triggers<br/>pre-signup<br/>post-authentication<br/>pre-token-generation<br/>custom-email-sender"]
        AUTHDB["DynamoDB<br/>authentication-log-table"]
        SES2["SES Construct<br/>DKIM + DMARC<br/>Email Templates"]
    end

    subgraph ENS["EasyGenomicsNestedStack"]
        EGL["Lambda Construct<br/>100+ handlers<br/>easy-genomics domain"]
        EGSQS["8 SQS FIFO Queues<br/>(direct publish, no SNS hop)"]
        EGSTR["laboratory-run-table<br/>DynamoDB Stream"]
        EGSQS -->|event source| EGL
        EGSTR -->|event source| EGL
    end

    %% The 11 easy-genomics tables are owned by EasyGenomicsApiStack (parent),
    %% not this nested stack — see EGDB9 above.

    subgraph OHNS["AwsHealthOmicsNestedStack"]
        OHL["Lambda Construct<br/>13 handlers"]
        OHDB["workflow-schema-table<br/>(schema cache)"]
        OHSM["Secrets Manager<br/>GitHub PAT"]
        OHEB["EventBridge Rule<br/>aws.tag events"]
        OHEB -->|trigger| OHL
    end

    subgraph NFNS["NFTowerNestedStack"]
        NFL["Lambda Construct<br/>13 handlers"]
        NFSSM["SSM Param Store<br/>nf-access-token"]
    end

    subgraph DPNS["DataProvisioningNestedStack"]
        CU["Cognito Users<br/>(sys-admin + test users)"]
        S3B["S3 Lab Bucket<br/>(default)"]
        SEED["DynamoDB Seed Data<br/>(org, lab, users, workflow access)"]
    end
```

### Stack → Construct mapping

| Stack                       | Top-level? | Constructs used                                                       |
| --------------------------- | ---------- | --------------------------------------------------------------------- |
| BackEndStack                | ✅         | VpcConstruct, KMS                                                     |
| AuthNestedStack             | —          | CognitoIdpConstruct, LambdaConstruct, DynamoDbConstruct, SesConstruct |
| AwsHealthOmicsNestedStack   | —          | LambdaConstruct, DynamoDbConstruct, SecretsManager, EventBridge       |
| NFTowerNestedStack          | —          | LambdaConstruct, SSM                                                  |
| EasyGenomicsApiStack        | ✅         | ApiGatewayConstruct, DynamoConstruct (×11 tables, RETAIN)             |
| EasyGenomicsNestedStack     | —          | LambdaConstruct (×N), SqsConstruct (×8)                               |
| DataProvisioningNestedStack | —          | CognitoUserConstruct, S3Construct, AwsCustomResource (DDB seed)       |
| FrontEndStack               | ✅         | WwwHostingConstruct (S3 + CloudFront + ACM + Route53)                 |

`AuthNestedStack`, `AwsHealthOmicsNestedStack`, and `NFTowerNestedStack` are children of `BackEndStack`.
`EasyGenomicsNestedStack` and `DataProvisioningNestedStack` are children of `EasyGenomicsApiStack`.

---

## 5. Back-End: Lambda Domains

Lambda handlers are auto-discovered from `*.lambda.ts` files. The `LambdaConstruct` maps filename prefixes to HTTP
methods and registers them with API Gateway.

```
create-*   → POST
read-*     → GET    (with {id} path param)
list-*     → GET
update-*   → PUT
delete-*   → DELETE
cancel-*   → DELETE
edit-*     → PUT
add-*      → POST
remove-*   → DELETE
search-*   → GET
request-*  → POST
confirm-*  → POST
process-*  → SQS event source (no HTTP route)
```

### Domain: `easy-genomics` (100+ handlers)

The diagram below shows a representative subset by feature area, not the full handler list — the domain has grown well
past the illustrated set since this doc was first written.

```mermaid
graph LR
    subgraph "User Management"
        U1["create-user-invitation"]
        U2["confirm-invitation"]
        U3["create-user-forgot-password"]
        U4["confirm-forgot-password"]
        U5["delete-user"]
        U6["process-delete-user ⚡SQS"]
        U7["process-create-user-invites ⚡SQS"]
    end

    subgraph "Organization Management"
        O1["create-organization"]
        O2["read-organization"]
        O3["list-organizations"]
        O4["update-organization"]
        O5["delete-organization"]
        O6["process-delete-organization ⚡SQS"]
        O7["add/edit/remove/list-organization-user"]
    end

    subgraph "Laboratory Management"
        L1["create-laboratory"]
        L2["read-laboratory"]
        L3["list-laboratories"]
        L4["update-laboratory"]
        L5["delete-laboratory"]
        L6["process-delete-laboratory ⚡SQS"]
        L7["add/edit/remove/list-laboratory-user"]
    end

    subgraph "Laboratory Runs"
        R1["create-laboratory-run"]
        R2["read-laboratory-run"]
        R3["list-laboratory-runs"]
        R4["update-laboratory-run"]
        R5["delete-laboratory-run"]
        R6["process-update-laboratory-run ⚡SQS"]
        R7["request-status-check"]
    end

    subgraph "File Operations"
        F1["request-file-download-url"]
        F2["list-bucket-objects"]
        F3["search-bucket-objects"]
        F4["request-folder-download-job"]
        F5["process-folder-download-job ⚡SQS"]
    end

    subgraph "Upload"
        UP1["create-file-upload-request"]
        UP2["create-file-upload-sample-sheet"]
    end

    subgraph "Workflow Access"
        W1["list-workflow-access"]
        W2["edit-workflow-access-batch"]
        W3["list-workflow-catalog"]
    end
```

### Domain: `aws-healthomics` (13 handlers)

```mermaid
graph LR
    subgraph "Workflows"
        H1["list-private-workflows"]
        H2["read-private-workflow"]
        H3["create-private-workflow"]
        H4["list-shared-workflows"]
        H5["list-workflow-versions"]
        H6["create-workflow-upload-request"]
        H7["read-workflow-schema"]
        H8["process-fetch-workflow-schema ⚡EventBridge"]
    end
    subgraph "Runs"
        H9["create-run-execution"]
        H10["cancel-run-execution"]
        H11["list-runs"]
        H12["read-run"]
        H13["read-run-tasks"]
    end
```

### Domain: `nf-tower` / Seqera (13 handlers)

```mermaid
graph LR
    subgraph "Compute"
        N1["list-compute-envs"]
        N2["read-compute-env"]
    end
    subgraph "Pipelines"
        N3["list-pipelines"]
        N4["read-pipeline"]
        N5["read-pipeline-launch-details"]
        N6["read-pipeline-schema"]
    end
    subgraph "Workflow Runs"
        N7["create-workflow-execution"]
        N8["cancel-workflow-execution"]
        N9["list-workflows"]
        N10["read-workflow"]
        N11["read-workflow-progress"]
        N12["read-workflow-metrics"]
        N13["read-workflow-reports"]
    end
```

### Auth Cognito Triggers (4 handlers)

| Handler                        | Trigger            | Purpose                           |
| ------------------------------ | ------------------ | --------------------------------- |
| `process-pre-signup`           | PreSignUp          | Validates sign-up attempt         |
| `process-post-authentication`  | PostAuthentication | Writes auth event to DynamoDB     |
| `process-pre-token-generation` | PreTokenGeneration | Injects custom claims into JWT    |
| `process-custom-email-sender`  | CustomEmailSender  | Delivers emails via SES templates |

---

## 6. Services Layer

Lambda handlers never call AWS SDKs directly — they go through service classes in `packages/back-end/src/app/services/`.

```mermaid
graph TB
    subgraph "Lambda Handlers"
        H["Any Lambda Handler"]
    end

    subgraph "AWS SDK Wrappers"
        DDB["dynamodb-service.ts<br/>put · get · query · scan<br/>delete · transact-write · batch-get"]
        S3S["s3-service.ts<br/>listObjects · presignedUrl<br/>multipart · getObject"]
        COG["cognito-idp-service.ts<br/>createUser · adminSetPassword<br/>forgotPassword · auth flows"]
        SESS["ses-service.ts<br/>sendTemplatedEmail"]
        SQS["sqs-service.ts<br/>sendMessage · receiveMessage"]
        SSM["ssm-service.ts<br/>getParameter (Seqera tokens)"]
        STS["sts-service.ts<br/>getCallerIdentity"]
        SM["secrets-manager-service.ts<br/>getSecretValue (GitHub PAT)"]
        OM["omics-service.ts<br/>startRun · listRuns · getWorkflow"]
    end

    subgraph "Domain Services"
        OS["organization-service.ts"]
        LS["laboratory-service.ts"]
        LUS["laboratory-user-service.ts"]
        US["user-service.ts"]
        UIS["user-invite-service.ts"]
        OLF["omics-lab-factory.ts"]
        WC["unified-workflow-catalog-service.ts"]
    end

    H --> OS & LS & LUS & US & UIS & WC & OLF
    OS & LS & LUS & US & UIS --> DDB & S3S & COG & SESS & SQS & SSM & STS & SM & OM
    OLF --> OM
    WC --> OM & SSM
```

`sns-service.ts` and `sns-construct.ts` still exist in the codebase but have no callers — async publishing goes straight
to `sqs-service.ts` (see [§7](#7-async-event-architecture)).

---

## 7. Async Event Architecture

Cascading deletes and async processing publish directly to FIFO SQS queues consumed by `process-*` Lambdas — there is no
SNS hop. Each former SNS topic had exactly one SQS subscriber, so the topic was collapsed away; messages still use a
legacy `SnsProcessingEvent`-shaped envelope (`{ Operation, Type, Record }`) so consumers that switch on `Type` didn't
need to change.

The laboratory-run table also has a DynamoDB Stream subscriber (`process-laboratory-run-stream`) that drives the TTL →
S3 deletion cascade — a second async path that doesn't go through SQS at all.

```mermaid
sequenceDiagram
    participant API as API Gateway
    participant L as Lambda Handler
    participant SQS as SQS FIFO Queue
    participant PL as process-* Lambda
    participant DDB as DynamoDB
    participant COG as Cognito

    Note over API,COG: Example: Delete Organization (cascade)
    API->>L: DELETE /organization/{id}
    L->>SQS: organization-management-queue<br/>{Type: OrganizationUser} × N
    L->>SQS: organization-management-queue<br/>{Type: Laboratory} × N
    L->>DDB: Delete Organization record
    SQS-->>PL: Trigger process-delete-organization
    PL->>DDB: Delete each OrganizationUser / Laboratory
    PL->>COG: Remove org users from Cognito

    Note over API,COG: Example: User Invitation
    API->>L: POST /user-invitation
    L->>DDB: Store invitation record
    L->>SQS: user-invite-queue
    SQS-->>PL: process-create-user-invites
    PL->>COG: Create Cognito user
    PL->>DDB: Update invitation status
```

### SQS Queue → Lambda mapping

| SQS Queue                                   | Lambda Processor                         | Trigger                                             |
| ------------------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| organization-management-queue               | process-delete-organization              | DELETE /organization (cascades to org users + labs) |
| laboratory-management-queue                 | process-delete-laboratory                | DELETE /laboratory                                  |
| user-management-queue                       | process-delete-user                      | DELETE /user                                        |
| laboratory-run-update-queue                 | process-update-laboratory-run            | Run status change                                   |
| laboratory-run-failure-classification-queue | process-classify-laboratory-run-failure  | Failed run → LLM classification                     |
| laboratory-run-notification-queue           | process-notify-laboratory-run-completion | Run completion → notification                       |
| user-invite-queue                           | process-create-user-invites              | POST /user-invitation                               |
| folder-download-queue                       | process-folder-download-job              | POST /request-folder-download-job                   |

`laboratory-run-table` DynamoDB Stream → `process-laboratory-run-stream` (TTL-expired records → cascading S3 deletion)
is a separate event source, not a queue.

---

## 8. Front-End Architecture

The front-end is a **Nuxt 3** SPA. It's statically built and served from CloudFront → S3.

```mermaid
graph TB
    subgraph "Browser"
        subgraph "Nuxt 3 App"
            subgraph "Pages / Routes"
                P1["/signin, /auth/callback"]
                P2["/admin/orgs/*"]
                P3["/orgs/[orgId]/*"]
                P4["/labs/[labId]/*"]
                P5["/labs/[labId]/run-workflow/*"]
                P6["/labs/[labId]/run-pipeline/*"]
            end

            subgraph "Pinia Stores"
                ST1["user.ts<br/>(auth state)"]
                ST2["orgs.ts"]
                ST3["labs.ts"]
                ST4["run.ts"]
                ST5["omicsWorkflows.ts"]
                ST6["seqeraPipelines.ts"]
                ST7["ui.ts / toast.ts"]
            end

            subgraph "Composables"
                C1["useAuth.ts<br/>(login/logout/refresh)"]
                C2["useMultiplatform.ts<br/>(Seqera + HealthOmics)"]
                C3["useFileDownload.ts"]
                C4["usePipeline.ts"]
            end

            subgraph "Repository Layer (API)"
                R0["factory.ts<br/>HttpFactory + token refresh"]
                R1["orgs.ts"]
                R2["labs.ts"]
                R3["users.ts"]
                R4["uploads.ts"]
                R5["file.ts"]
                R6["omics-workflows.ts"]
                R7["omics-runs.ts"]
                R8["seqera-pipelines.ts"]
                R9["seqera-runs.ts"]
                R10["workflow-access.ts"]
            end
        end
    end

    subgraph "EG Components (EG*)"
        CO["50+ EGXxx.vue components<br/>EGTable, EGDialog, EGFileExplorer<br/>EGRunWorkflowForm*, EGStatusChip, ..."]
    end

    Pages --> Stores --> Composables --> Repository
    Pages --> CO

    R0 -->|"Bearer JWT"| APIGW["Easy Genomics<br/>API Gateway"]
    R0 -->|"direct"| SEQERA["Seqera Tower API<br/>api.cloud.seqera.io"]
```

### Repository → API Gateway mapping

| Repository Module   | API Domain      | Key Endpoints                           |
| ------------------- | --------------- | --------------------------------------- |
| orgs.ts             | easy-genomics   | /organization/\*                        |
| labs.ts             | easy-genomics   | /laboratory/\*                          |
| users.ts            | easy-genomics   | /user/_, /user-invitation/_             |
| uploads.ts          | easy-genomics   | /upload/\*                              |
| file.ts             | easy-genomics   | /file/_, /bucket/_                      |
| workflow-access.ts  | easy-genomics   | /workflow-access/\*, /workflow-catalog  |
| omics-workflows.ts  | aws-healthomics | /private-workflow/_, /shared-workflow/_ |
| omics-runs.ts       | aws-healthomics | /run-execution/_, /run/_                |
| seqera-pipelines.ts | nf-tower        | /pipeline/_, /compute-envs/_            |
| seqera-runs.ts      | nf-tower        | /workflow-execution/_, /workflow/_      |

### Front-End Route → Feature map

| Route                             | Feature                                |
| --------------------------------- | -------------------------------------- |
| `/signin`                         | Cognito hosted UI or username/password |
| `/auth/callback`                  | OAuth redirect handler (Google SSO)    |
| `/admin/orgs/`                    | System Admin: manage all organizations |
| `/orgs/[orgId]/`                  | Org Admin: manage org members and labs |
| `/labs/`                          | User's laboratories list               |
| `/labs/[labId]/`                  | Lab dashboard: runs, files, users      |
| `/labs/[labId]/run-workflow/[id]` | Launch HealthOmics workflow            |
| `/labs/[labId]/run-pipeline/[id]` | Launch Seqera pipeline                 |
| `/labs/[labId]/run/[runId]`       | View run details + status              |
| `/labs/[labId]/omics-run/[id]`    | HealthOmics run details                |
| `/labs/[labId]/seqera-run/[id]`   | Seqera run details                     |
| `/labs/[labId]/sample-sheet`      | Upload sample sheet CSV                |

---

## 9. Authentication Flow

```mermaid
sequenceDiagram
    participant U as User Browser
    participant FE as Nuxt App
    participant COG as Cognito Hosted UI
    participant LAUTH as process-pre-token-generation Lambda
    participant APIGW as API Gateway
    participant LAM as Lambda Handler

    Note over U,LAM: Standard Sign-In (username/password)
    U->>FE: Navigate to /signin
    FE->>COG: InitiateAuth (SRP flow)
    COG->>LAUTH: PreTokenGeneration trigger
    LAUTH->>COG: Add custom claims (role, orgId, labIds)
    COG-->>FE: id_token + access_token + refresh_token
    FE->>FE: Store tokens in Pinia (user store)

    Note over U,LAM: Authenticated API Call
    U->>FE: User action
    FE->>APIGW: GET /laboratory/list<br/>Authorization: Bearer <id_token>
    APIGW->>LAM: Invoke handler
    LAM->>LAM: Verify JWT (issuer = Cognito pool)
    LAM->>LAM: Extract claims (userId, role)
    LAM-->>APIGW: 200 { laboratories: [...] }
    APIGW-->>FE: Response
    FE->>FE: Update Pinia store

    Note over U,LAM: Token Refresh (factory.ts intercepts 401)
    FE->>APIGW: Request with expired token
    APIGW-->>FE: 401
    FE->>COG: RefreshToken
    COG-->>FE: New id_token
    FE->>APIGW: Retry original request
```

### Cognito User Pool configuration

| Setting         | Value                                                  |
| --------------- | ------------------------------------------------------ |
| Password policy | Min 8 chars, 1 number, 1 special, 1 upper, 1 lower     |
| Auth flows      | USER_SRP_AUTH, ALLOW_REFRESH_TOKEN_AUTH                |
| MFA             | Optional TOTP                                          |
| Domain          | `{name-prefix}-easy-genomics` (Cognito hosted UI)      |
| Google OAuth    | Configured via google-client-id + google-client-secret |
| Callback URLs   | `{app-domain}/auth/callback`                           |

---

## 10. Key Data Flows

### Run a HealthOmics Workflow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Nuxt App
    participant EG as easy-genomics Lambda
    participant OH as aws-healthomics Lambda
    participant DDB as DynamoDB
    participant SQS as SQS
    participant PL as process-update-laboratory-run
    participant HO as AWS HealthOmics

    U->>FE: Fill workflow form → Submit
    FE->>OH: POST /run-execution (workflowId, params)
    OH->>HO: StartRun API call
    HO-->>OH: runId
    OH->>EG: POST /laboratory-run (create record)
    EG->>DDB: Put laboratory-run-table<br/>{status: RUNNING, runId, labId}
    EG->>SQS: Publish to laboratory-run-update-queue
    SQS-->>PL: triggers
    PL->>HO: GetRun (poll status)
    HO-->>PL: status
    PL->>DDB: Update laboratory-run status

    Note over U,HO: User polls run status
    U->>FE: View run details
    FE->>EG: GET /laboratory-run/{runId}
    EG->>DDB: Query laboratory-run-table
    DDB-->>EG: {status, outputs, ...}
    EG-->>FE: Run details
```

### File Upload Flow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Nuxt App
    participant LAM as upload Lambda
    participant S3 as S3 Lab Bucket

    U->>FE: Select file(s) for upload
    FE->>LAM: POST /upload/file-upload-request<br/>{fileName, labId}
    LAM->>S3: Generate presigned PUT URL
    S3-->>LAM: presigned URL (15 min TTL)
    LAM-->>FE: { uploadUrl, key }
    FE->>S3: PUT file directly to S3<br/>(no Lambda in path)
    S3-->>FE: 200 OK
```

### File Download Flow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Nuxt App
    participant LAM as file Lambda
    participant SQS as SQS
    participant PL as process-folder-download-job
    participant S3 as S3

    Note over U,S3: Single file
    U->>FE: Click download
    FE->>LAM: POST /file/request-file-download-url
    LAM->>S3: GeneratePresignedUrl (GET)
    LAM-->>FE: { downloadUrl }
    FE->>U: Browser download via presigned URL

    Note over U,S3: Folder download (async)
    U->>FE: Download folder
    FE->>LAM: POST /file/request-folder-download-job
    LAM->>SQS: Publish to folder-download-queue
    SQS-->>PL: triggers
    PL->>S3: List + zip objects
    PL->>S3: Upload zip
    PL-->>FE: presigned URL for zip
```

### User Invitation Flow

```mermaid
sequenceDiagram
    participant A as Admin
    participant FE as Nuxt App
    participant LAM as user Lambda
    participant DDB as DynamoDB
    participant SQS as SQS
    participant PL as process-create-user-invites
    participant COG as Cognito
    participant SES as SES (Email)
    participant U as New User

    A->>FE: Invite user (email + role)
    FE->>LAM: POST /user-invitation
    LAM->>DDB: Store invitation {email, role, token, expiry}
    LAM->>SQS: Publish to user-invite-queue
    SQS-->>PL: triggers
    PL->>COG: AdminCreateUser (temp password)
    PL->>SES: SendTemplatedEmail (invite link + token)
    SES->>U: Email with accept link
    U->>FE: Click link → /accept-invitation?token=...
    FE->>LAM: POST /confirm-invitation {token, password}
    LAM->>DDB: Mark invitation as accepted
    LAM->>COG: AdminSetUserPassword (permanent)
```

---

## 11. Data Model

### DynamoDB Tables

```mermaid
erDiagram
    ORGANIZATION {
        string OrganizationId PK
        string Name
        string Status
        string CreatedAt
    }
    LABORATORY {
        string OrganizationId PK
        string LaboratoryId SK
        string Name
        string S3Bucket
        string Status
    }
    USER {
        string UserId PK
        string Email
        string Status
        string SystemAdmin
    }
    ORGANIZATION_USER {
        string OrganizationId PK
        string UserId SK
        string Role
        string Status
    }
    LABORATORY_USER {
        string LaboratoryId PK
        string UserId SK
        string OrganizationId
        string Role
        string Status
    }
    LABORATORY_RUN {
        string LaboratoryId PK
        string RunId SK
        string UserId
        string OrganizationId
        string Status
        string Platform
        number ExpiresAt
    }
    LABORATORY_WORKFLOW_ACCESS {
        string LaboratoryId PK
        string WorkflowKey SK
    }
    LABORATORY_S3_ACCESS {
        string LaboratoryId PK
        string BucketName SK
    }
    LABORATORY_DATA_TAGGING {
        string LaboratoryId PK
        string Sk SK
        string Gsi1Pk
        string Gsi1Sk
    }
    WORKFLOW_RUN_PRESET {
        string LaboratoryId PK
        string Sk SK
    }
    UNIQUE_REFERENCE {
        string Value PK
        string Type SK
    }
    WORKFLOW_SCHEMA {
        string WorkflowId PK
        string Version SK
        string Schema
    }
    AUTH_LOG {
        string UserName PK
        string DateTime SK
        string EventType
    }

    ORGANIZATION ||--o{ LABORATORY : "contains"
    ORGANIZATION ||--o{ ORGANIZATION_USER : "has members"
    LABORATORY ||--o{ LABORATORY_USER : "has members"
    LABORATORY ||--o{ LABORATORY_RUN : "has runs"
    LABORATORY ||--o{ LABORATORY_WORKFLOW_ACCESS : "allowlist"
    LABORATORY ||--o{ LABORATORY_S3_ACCESS : "bucket allowlist"
    LABORATORY ||--o{ LABORATORY_DATA_TAGGING : "tags S3 objects"
    LABORATORY ||--o{ WORKFLOW_RUN_PRESET : "saved run presets"
    USER ||--o{ ORGANIZATION_USER : "belongs to"
    USER ||--o{ LABORATORY_USER : "belongs to"
    USER ||--o{ LABORATORY_RUN : "creates"
```

### Role Hierarchy

```
System Admin
 └── Org Admin (per Organization)
      └── Lab Manager (per Laboratory)
           └── Lab Technician (per Laboratory)
```

| Role           | Capabilities                                       |
| -------------- | -------------------------------------------------- |
| System Admin   | Manage all orgs, all users, platform-wide settings |
| Org Admin      | Manage org labs and org users                      |
| Lab Manager    | Manage lab users, workflow access, run workflows   |
| Lab Technician | View runs, upload files, run workflows             |

---

## 12. CI/CD Pipeline

```mermaid
graph TD
    subgraph "Triggers"
        PR["Pull Request"] --> LINT
        INFRA["infra/* branch push"] --> SANDBOX
        DEV["development branch push"] --> QUALITY
        STAGING["staging branch push"] --> UAT
    end

    LINT["pull-request-lint.yml<br/>Validate PR title<br/>(Conventional Commits)"]

    subgraph SANDBOX["cicd-release-sandbox.yml"]
        SB1["AWS OIDC Auth<br/>(assume deploy role)"]
        SB2["pnpm install + NX affected"]
        SB3["cicd-build-deploy-back-end<br/>(shared-lib + back-end CDK)"]
        SB4["cicd-build-deploy-front-end<br/>(shared-lib + Nuxt + CDK)"]
        SB1 --> SB2 --> SB3 --> SB4
    end

    subgraph QUALITY["cicd-release-quality.yml"]
        Q1["AWS OIDC Auth"]
        Q2["pnpm install"]
        Q3["Build + Deploy Back-End"]
        Q4["Build + Deploy Front-End"]
        Q5["Install Playwright + Chromium"]
        Q6["pnpm run test-e2e<br/>(headless Chromium)"]
        Q7["Slack notification<br/>(test results)"]
        Q1 --> Q2 --> Q3 --> Q4 --> Q5 --> Q6 --> Q7
    end

    subgraph UAT["cicd-release-quality-uat.yml"]
        U1["Same as Quality<br/>+ UAT environment"]
    end
```

### CI/CD Environment Variables

| Variable                      | Used for                           |
| ----------------------------- | ---------------------------------- |
| `AWS_ACCOUNT_ID`              | CDK deploy target                  |
| `AWS_REGION`                  | CDK + Lambda region                |
| `ENV_TYPE`                    | `dev` / `pre-prod` / `prod`        |
| `ENV_NAME`                    | Stack name prefix (e.g. `quality`) |
| `APP_DOMAIN_NAME`             | CloudFront + Route 53              |
| `AWS_HOSTED_ZONE_ID`          | Route 53 hosted zone (prod only)   |
| `AWS_CERTIFICATE_ARN`         | ACM cert (prod only)               |
| `JWT_SECRET_KEY`              | Lambda JWT verification            |
| `SYSTEM_ADMIN_EMAIL/PASSWORD` | E2E test credentials               |
| `SEQERA_API_BASE_URL`         | Optional self-hosted Seqera        |

---

## 13. Local Development Architecture

```mermaid
graph LR
    subgraph "Local Machine"
        FE["Nuxt Dev Server<br/>localhost:3000<br/>USE_LOCAL_BACKEND=1"]
        LS["local-server<br/>Express<br/>localhost:3001"]
    end

    subgraph "AWS (deployed dev stack)"
        DDB["DynamoDB"]
        COG["Cognito"]
        S3["S3"]
        SQS["SQS"]
        HO["HealthOmics"]
        ST["Seqera Tower"]
    end

    FE -->|"REST + JWT"| LS
    FE -->|"Auth"| COG
    LS -->|"real AWS calls"| DDB & COG & S3 & HO & ST
    SQS -->|"still runs in AWS"| AWS_PROC["process-* Lambdas<br/>(run in cloud, not local)"]
```

### How local-server works

The local server (`packages/back-end/src/local-server/`) runs Lambda handlers in-process inside an Express server:

1. **route-registry.ts** — scans `*.lambda.ts` files, maps filename prefix → HTTP method, registers Express routes
2. **lambda-invoker.ts** — dynamically `import()`s the handler, invokes the exported `handler` function
3. **event-builder.ts** — converts the Express `Request` into an `APIGatewayProxyEvent` shape
4. **auth-middleware.ts** — validates Cognito JWT (or skips if `SKIP_JWT_VERIFY=true`)

`process-*` handlers are excluded from HTTP routes — they only run via SQS in the deployed stack.

### Local dev commands

```bash
# From repo root — build shared-lib first (required once)
pnpm run build-back-end

# Terminal 1 — local API server
cd packages/back-end && pnpm run local-server
# or with watch: pnpm run local-server:watch

# Terminal 2 — front-end dev server pointing at local API
cd packages/front-end && USE_LOCAL_BACKEND=1 pnpm run nuxt-dev

# Regenerate front-end AWS config after re-deploying
cd packages/front-end && pnpm run nuxt-load-settings
```

### `.env.local` required variables

| Variable                      | Description                                     |
| ----------------------------- | ----------------------------------------------- |
| `NAME_PREFIX`                 | e.g. `dev-demo` — used for DynamoDB table names |
| `ACCOUNT_ID`                  | AWS account ID                                  |
| `REGION`                      | Must match Cognito pool region                  |
| `COGNITO_USER_POOL_ID`        | Must match what the front-end uses to sign in   |
| `COGNITO_USER_POOL_CLIENT_ID` | From the same Cognito pool                      |
| `JWT_SECRET_KEY`              | Must match the deployed stack's value           |

---

## 14. Configuration System

All configuration flows from a single source: `config/easy-genomics.yaml`.

```mermaid
graph TD
    YAML["config/easy-genomics.yaml"]
    SCHEMA["ConfigurationSettingsSchema<br/>(Zod, .strict())<br/>packages/shared-lib/src/app/schema/configuration.ts"]
    YAML -->|loadConfigurations| SCHEMA
    SCHEMA -->|validated| BEMain["packages/back-end/src/main.ts<br/>(BackEndStack CDK)"]
    SCHEMA -->|validated| FEMain["packages/front-end/src/main.ts<br/>(FrontEndStack CDK)"]
    BEMain --> BESTACKS["All back-end nested stacks"]
    FEMain --> FESTACKS["FrontEndStack"]
```

**Important:** The schema uses `.strict()` — any unrecognized key in the yaml causes the entire configuration to be
silently rejected (returns empty array → throws "Configuration missing / invalid"). Always validate new fields against
`ConfigurationSettingsSchema`.

### Config key reference

| Key                            | Required  | Description                                                                               |
| ------------------------------ | --------- | ----------------------------------------------------------------------------------------- |
| `aws-account-id`               | Yes       | AWS account ID (quote if starts with `00`)                                                |
| `aws-region`                   | Yes       | AWS region (e.g. `us-west-2`)                                                             |
| `env-type`                     | Yes       | `dev` / `pre-prod` / `prod`                                                               |
| `app-domain-name`              | Yes       | Base domain (CloudFront or Route53)                                                       |
| `aws-hosted-zone-id`           | prod only | Route 53 hosted zone                                                                      |
| `aws-certificate-arn`          | prod only | ACM certificate                                                                           |
| `aws-easy-genomics-api-url`    | Optional  | Override Front-End's easy-genomics API URL when the back-end splits it into its own stack |
| `google-client-id`             | Optional  | Google SSO                                                                                |
| `google-client-secret`         | Optional  | Google SSO                                                                                |
| `cognito-domain-prefix`        | Optional  | SSO callback domain                                                                       |
| `callback-urls`                | Optional  | Cognito OAuth callback                                                                    |
| `logout-urls`                  | Optional  | Cognito OAuth logout                                                                      |
| `back-end.jwt-secret-key`      | Optional  | JWT signing (auto-generated if absent)                                                    |
| `back-end.seqera-api-base-url` | Optional  | Self-hosted Seqera                                                                        |
| `back-end.vpc-peering.*`       | Optional  | VPC peering accepter details                                                              |
| `back-end.sys-admin-email`     | Yes       | Initial system admin                                                                      |
| `back-end.sys-admin-password`  | Yes       | Initial system admin password                                                             |
| `analytics.enabled`            | Optional  | Opt-in privacy-safe usage analytics (PostHog), off by default                             |
| `analytics.allow-dev`          | Optional  | Allow analytics on a `dev` env-type deployment                                            |
| `cost-explorer.enabled`        | Optional  | Deploys the daily Cost Explorer sync Lambda for billed-run-cost reporting                 |

The GitHub PAT used for nf-core schema fetches (`github-pat-secret-name`) is not part of `ConfigurationSettingsSchema` —
it's passed to `AwsHealthOmicsNestedStack` via CI/CD environment, not the yaml config.
