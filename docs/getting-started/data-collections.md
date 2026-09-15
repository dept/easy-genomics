# Data Collections

This guide covers the lab **Data Collections** page: how to import files, organize them into samples, tag and batch
them, build sequence collections, and launch a workflow from a collection.

If you have not created a lab yet, complete [Your first workflow run](./first-workflow-run.md) through lab setup first.
That guide uploads data inside the run wizard; this guide is the alternate path for managing lab data before you run.

## Concepts

| Term                    | Meaning                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Sample**              | A named group of files that belong together for analysis (for example paired R1/R2 FASTQs).                          |
| **Sequence collection** | A saved bundle of samples plus a sample-sheet column schema, ready to launch a workflow.                             |
| **Unlinked files**      | Objects in the lab S3 bucket that are not attached to any sample yet (instrument dumps, manual drops, leftovers).    |
| **Tag**                 | A labelled color chip you attach to samples for filtering and bulk actions (name ≤ 40 characters).                   |
| **Batch**               | A grouping applied at import time so samples from one import stay together in the Samples explorer.                  |
| **Default S3 bucket**   | The lab’s configured bucket/prefix. Required for Import, Files (unlinked) scanning, and launching from a collection. |

Data Collections is lab-scoped. There is no separate share or permissions UI for collections; access follows lab
membership (see [Roles and access](#8-roles-and-access)).

---

## 1. Open Data Collections

1. Open your lab (`/labs/{labId}`).
2. Choose the **Data Collections** tab.

The page has three sub-tabs:

| Sub-tab                  | Purpose                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Samples**              | Build the Sequence Collections you run workflows from — starting with the samples in your lab.                                                     |
| **Sequence Collections** | Saved bundles of samples ready to launch a workflow on.                                                                                            |
| **Files**                | Files sitting in the lab’s S3 bucket that didn’t come through an import — instrument dumps, manual drops, leftovers. Not grouped into samples yet. |

### Prerequisite: Default S3 bucket

If the lab has no **Default S3 bucket directory**, an amber banner explains that Data Collections features are disabled
until Settings are updated:

- Users who can edit lab details see **Open Settings**.
- Others are asked to contact an **organization administrator**.

Without a default bucket, **Import data** is disabled and the **Files** tab cannot scan unlinked objects.

---

## 2. Samples

The **Samples** sub-tab is the main explorer for samples already in the lab.

### Browse and select

- **Search** — filter by sample ID or batch name (“Search by sample ID or batch…”).
- **Card / Table** — switch between card and table layouts.
- Samples are grouped by **batch** (Unbatched first, then batches by created date). Each batch header shows counts of
  samples not yet analyzed vs analyzed, and **Select batch** / **Deselect batch**.
- Select samples with click, checkbox, keyboard **Enter** / **Space**, or by **dragging a lasso** on empty space in the
  explorer.
- Use select all / deselect all for the currently displayed samples.

### Tags sidebar

The left **Tags** rail lets you:

- Filter **Untagged** samples (with count).
- Multi-select standard tags (color dot + name + count) to filter the explorer.
- **+ New Tag** — name (max 40 characters) and a preset color (or custom `#RRGGBB`).
- **Delete** a tag (trash on hover) — confirm removes the tag and its associations from samples. Samples themselves are
  not deleted.

### Bulk actions

With one or more samples selected, the bulk bar offers:

| Action                        | What it does                                                                |
| ----------------------------- | --------------------------------------------------------------------------- |
| **Add Tags**                  | Attach existing tags; you can also create a tag inline while adding.        |
| **Remove Tags**               | Remove tags that appear on the selection.                                   |
| **Build sequence collection** | Opens the [collection builder](#6-sequence-collections) with those samples. |

### Analysis history

Each sample shows analysis status: **Not yet analyzed**, **Analyzed**, or **Analyzed Nx**. Hover the status for a
popover listing prior runs:

- Click a run **name** to open results in a new tab.
- Click the **right side** of a run row to select that run’s samples in the explorer.
- Empty state: “This sample hasn’t been analyzed yet.”

### Import entry point

Choose **Import data** (disabled without a default S3 bucket) to open the [Import wizard](#3-import-data).

---

## 3. Import data

**Import data** walks through five steps: **Source** → **Group files** → **Tags** → **Review samples** → **Confirm**.

### Source

Pick where the files come from. Files are copied or uploaded into the lab bucket on import — **external originals are
never modified**.

| Source                   | When to use                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------- |
| **Amazon S3**            | Point at a bucket/prefix where sequencer or partner files are dropped.                |
| **Upload from computer** | Drag and drop local files (each file ≤ **5 GB**). Browser upload into the lab bucket. |

For S3, enter bucket and optional prefix, then continue so Easy Genomics can list objects under that location.

### Group files

Apply a filename **regex** (presets or custom) to propose sample groups. A preview shows how many samples will be
created. Files that do not match the pattern are listed as unmatched and skipped unless you change the regex.

### Tags (optional)

Optionally upload a CSV/TSV/TXT sheet that maps sample names to tags:

- Choose which columns are the sample name and the tag values.
- Easy Genomics reports matches, typo warnings, and tags that will be created.

You can skip this step and continue without a tag sheet.

### Review samples

Review proposed samples (paired-end, single-end, or needs review). **Exclude** or **Include** individual proposals
before confirming.

### Confirm

1. Review source and sample count.
2. **Assign batch** — **Create new batch** (name max 250 characters) or **Use existing batch**.
3. Confirm:
   - S3 source: **Copy & create N samples**
   - Upload source: **Create N samples**

After success you return to the **Samples** tab with the new samples loaded.

---

## 4. Files (unlinked)

The **Files** sub-tab lists objects in the lab bucket that are not linked to any sample.

### Scan and filter

- Banner shows `s3://bucket/prefix`, object count, and **Last scan …**.
- **Search file names…**
- File-type filter:
  - **FASTQ** — raw sequencing reads (`.fastq.gz`)
  - **FASTA** — reference genomes and assemblies (`.fasta`, `.fa`)
  - **Workflow outputs & other** — logs, CSV reports, HTML summaries, archives (rarely used as inputs)
- **Rescan bucket** — re-lists unlinked objects.

If S3 is not configured, the tab prompts you to set **Default S3 bucket directory** in Settings (or ask an org admin).

### Build samples from files

Select files, then:

| Action                    | Requirement                   | Result                                                                |
| ------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| **Group with regex**      | At least **2** selected files | Pattern → Review → Confirm; presets or custom regex; Exclude/Include. |
| **Build sample manually** | One or more selected files    | Name + layout → one sample.                                           |

**Layouts** for manual build:

| Layout                 | Typical use                                  |
| ---------------------- | -------------------------------------------- |
| Paired-end             | Matching R1 / R2 FASTQs                      |
| Single-end             | One read file per sample                     |
| Long reads             | Long-read / single-file reads                |
| Paired-end with extras | Paired FASTQs plus optional FASTA/GTF extras |

Unmatched files from regex grouping are skipped; adjust the pattern if you need them included.

---

## 5. Sequence Collections

The **Sequence Collections** sub-tab lists saved collections.

- **Search sequence collections…**
- **+ New Sequence Collection** — opens the builder with no pre-selected samples (or start from Samples bulk **Build
  sequence collection**).
- Table columns: Name, Created date, Sample count, Schema column count.
- Empty state: “No sequence collections yet.”

### Row actions

| Action              | What it does                                                                    |
| ------------------- | ------------------------------------------------------------------------------- |
| **Launch Workflow** | Opens the launch modal (see [Launch Workflow](#7-launch-workflow)).             |
| **Edit**            | Opens the builder for that collection.                                          |
| **Delete**          | Permanently deletes the collection only. **Samples and files are not deleted.** |

---

## 6. Collection builder

**New sequence collection** / **Edit collection** lets you:

1. Set a **Collection name** (max 250 characters).
2. Multi-select **samples** (search by name).
3. Choose a **Schema** preset or customize columns:
   - Presets: **Single**, **Paired**, **Hybrid**, **Assembled**
   - Custom: edit column names and roles; **+ Add column** / remove columns
4. Review the live **Sample sheet preview** (first rows of the selected samples).
5. **Save collection** or **Save changes**.

Name and at least one sample are required. Schema validation must pass before save.

---

## 7. Launch Workflow

From a sequence collection’s row menu → **Launch Workflow**:

1. Enter a **run name** (defaults can follow the collection name).
2. Select a **workflow** enabled on the lab (**AWS HealthOmics** and/or **Seqera Cloud**).
3. Continue — Easy Genomics **generates a sample sheet** from the collection and opens the run wizard in a **new tab**.

The wizard is seeded from Data Collections (`from=data-collections`): files from the collection are already included, so
you skip the usual upload step and continue to parameters and launch. See
[Your first workflow run](./first-workflow-run.md) for the shared review-and-launch steps.

---

## 8. Roles and access

Lab members with any of the following can use Data Collections APIs and the page (subject to lab membership):

- System Admin
- Organization Admin (for that lab’s organization)
- Lab Manager
- Lab Technician

There is **no separate share control** for samples or sequence collections. Access is the same lab-scoped model as other
lab features. Configuring the lab’s default S3 bucket requires permission to edit lab details (typically Org Admin / Lab
Manager depending on your deployment’s policies).

---

## 9. What this page does not do today

The current Data Collections UI does **not** provide:

- Dedicated **edit** or **delete sample** actions
- **Rename tag** in the UI (create and delete only)
- **File-level** tagging or file-tag filters
- **Reassigning** a sample to a different batch after import
- Sharing a collection outside the lab

---

## Related docs

- [Your first workflow run](./first-workflow-run.md) — org/lab setup and run-wizard upload path
- [Troubleshooting](../operations/troubleshooting.md) — Data Collections and sample-sheet failures
