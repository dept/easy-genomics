# HealthOmics VPC Networking — Setup & Design Rationale

## What this is

A laboratory can opt its AWS HealthOmics workflow runs into a specific VPC by referencing an existing AWS HealthOmics
**Configuration** resource, instead of the default `RESTRICTED` networking mode (S3 + ECR, same Region only). This lets
workflow tasks reach resources `RESTRICTED` mode can't: public reference datasets over the internet, third-party license
servers, or private resources inside a lab's own VPC (including on-prem data over Direct Connect).

Easy Genomics only stores a **reference** to the Configuration (its name) and passes it at launch. It does not create,
list, or manage the Configuration, the VPC, subnets, or security groups — all of that is provisioned and owned outside
the app, by whoever administers the AWS account (referred to below as "ops").

## Why there's no dropdown of available VPCs

The lab-settings UI asks an admin to type the Configuration's exact name, rather than offering a dropdown populated from
AWS. This is a deliberate choice, not a missing feature:

1. **HealthOmics Configurations have no per-org or per-lab ownership.** They're flat account/Region-wide resources. If
   Easy Genomics called `ListConfigurations` and rendered every result in a dropdown, any lab admin in **any**
   organization sharing that AWS account would see every other organization's Configuration names — a cross-tenant
   visibility leak in a platform that is otherwise strictly scoped per organization.
2. **Making it safe requires infrastructure Easy Genomics doesn't own.** Scoping a list view correctly would mean ops
   tagging every Configuration with an `OrganizationId` at creation time and Easy Genomics filtering
   `ListConfigurations` results by that tag — a real feature with its own design, IAM permission
   (`omics:ListConfigurations`), and a new API route, not a small UI tweak. It also depends on ops consistently
   following a tagging convention that doesn't exist today.
3. **This matches the platform's existing reference-model pattern.** Seqera/Nextflow Tower compute environments are
   handled the same way: Easy Genomics references external infrastructure by name/ID rather than provisioning or
   enumerating it.

Instead, Easy Genomics validates whatever name is entered at save time (`GetConfiguration`, must return
`status: ACTIVE`) and again implicitly at launch (a stale/deleted Configuration simply fails `StartRun`, surfaced
through the normal run-failure path). A typo or a reference to a deleted Configuration is caught immediately with a
clear error — see `EG-309` (not found) and `EG-310` (not `ACTIVE`) in `ERROR_HANDLING.md`.

If your organization wants a self-service picker in the future, that's a separate, scoped follow-up (tagging
convention + list endpoint + IAM), not a change to this feature.

## Creating a Configuration (ops-only, out-of-band)

### Via AWS CLI

```bash
aws omics create-configuration \
  --name your-config-name \
  --description "VPC config for <org/lab> genomics workflows" \
  --run-configurations '{
    "vpcConfig": {
      "securityGroupIds": ["sg-0123456789abcdef0"],
      "subnetIds": ["subnet-0a1b2c3d4e5f60789", "subnet-1a2b3c4d5e6f70890"]
    }
  }'
```

- `securityGroupIds`: 1–5 security groups, all in the same VPC.
- `subnetIds`: 1–16 subnets, all in the same VPC and Region as the security groups.
- The Configuration takes up to ~15 minutes to transition `CREATING` → `ACTIVE`. Poll it:

```bash
aws omics get-configuration --name your-config-name --query 'status'
```

Only reference the name in Easy Genomics once this returns `"ACTIVE"` — Easy Genomics' save-time validation will reject
anything else.

To find Configurations that already exist in the account:

```bash
aws omics list-configurations --query 'items[].{Name:name,Status:status,Arn:arn}' --output table
```

### Via AWS Console

1. Open the **AWS HealthOmics** console in the target account and Region.
2. In the left navigation, look for **Configurations** (under the storage/compute section of the HealthOmics console —
   exact placement may vary slightly by console version; use the search box if it's not immediately visible).
3. Click **Create configuration**, provide a name and description, and select **VPC** as the networking type.
4. Choose the VPC, one or more subnets, and one or more security groups.
5. Create it, then wait for **Status** to show **Active** before handing the name to whoever is configuring the lab in
   Easy Genomics.

## Wiring it into a lab

In Easy Genomics, on a lab's Settings page (Edit mode), with **Enable HealthOmics Integration** on:

1. Set **Networking mode** to **VPC**.
2. Enter the exact Configuration name from the steps above in **VPC configuration name**.
3. Save. Easy Genomics calls `GetConfiguration` and rejects the save if the name doesn't exist or isn't `ACTIVE`.

One-time, account-level prerequisite (also ops-owned, not part of this app): the `AWSServiceRoleForHealthOmics`
service-linked role must exist so HealthOmics can manage ENIs in the referenced subnets for VPC-mode runs.
