# Seqera / Nextflow cost labels for Easy Genomics

Easy Genomics can show **estimated** Seqera compute cost from Tower’s `progress.workflowProgress.cost` without any extra
configuration.

**Billed** per-run AWS spend for Seqera / Batch runs requires customer-operated tagging. Easy Genomics cannot enforce
this in code.

## What you need

### 1. Compute environment resource labels (lab / CE level)

When creating an AWS Batch compute environment with **Batch Forge**, add static resource labels such as:

- `Application=easy-genomics`
- `LaboratoryId=<uuid>`
- `OrganizationId=<uuid>`
- `Platform=Seqera Cloud`

Forge propagates these to EC2, VPC, FSx/EFS, and related resources. Labels added only at pipeline launch do **not** tag
already-running EC2 instances.

### 2. Dynamic / per-run labels (workflow level)

Enable Seqera **dynamic resource labels** (e.g. `${workflowId}`, `${sessionId}`) at the workspace or compute-environment
level so each run’s Batch jobs get a unique workflow identifier.

Optionally add Nextflow `resourceLabels` in CE staging config or pipeline config:

```
process {
  resourceLabels = [
    'Application': 'easy-genomics',
    'LaboratoryId': '<lab-uuid>'
  ]
}
```

Per-run values are best supplied via Seqera dynamic labels rather than hard-coding `RunId` in every pipeline repo.

### 3. AWS Billing

1. Activate the label keys as **cost allocation tags** in the Billing console (up to 24 hours to appear).
2. For **container-level / shared Batch** attribution with dynamic labels, enable **Split Cost Allocation Data** and use
   **CUR / Data Exports**. Seqera documents that dynamic resource label costs are **not** visible in Cost Explorer
   alone.

See:

- [Seqera resource labels](https://docs.seqera.io/platform-cloud/resource-labels/overview)
- [Seqera AWS labels blog](https://seqera.io/blog/aws-labels-cost-tracking/)

## What Easy Genomics does with this

| Capability                                 | Requirement                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-run estimate (historical Tower costs)  | Platform outcomes stored on `LaboratoryRun`                                                                                                        |
| Post-run estimate (immediate)              | Tower `progress.cost` at terminal state                                                                                                            |
| Post-run **billed** cost via Cost Explorer | HealthOmics `RunId` tags work out of the box; Seqera needs labels above — otherwise CE sync may only attribute HealthOmics / lab-level Batch spend |

## Effort estimate

- Static CE labels at Forge creation: **low–medium** (may require a new CE)
- Dynamic labels in Seqera UI: **low**
- CUR + Split Cost Allocation for true per-run Batch: **higher** (billing ops)

Without labels, Easy Genomics still shows Seqera **estimates**; billed cost may remain pending or lab-level only.
