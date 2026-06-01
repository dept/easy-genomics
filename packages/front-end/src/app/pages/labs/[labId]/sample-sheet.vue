<script setup lang="ts">
  interface TableData {
    headers: string[];
    data: string[][];
    metadata: {
      labName: string;
      pipelineOrWorkflowName: string;
      platform: string;
      runName: string;
    };
  }

  definePageMeta({ layout: 'sample-sheet' });

  const { $api } = useNuxtApp();
  const route = useRoute();

  const labsStore = useLabsStore();

  const labId = route.params.labId as string;
  const labName = computed<string>(() => {
    const lab = labsStore.labs[labId];

    if (!lab) throw new Error(`no lab found for id ${labId}`);

    return lab.Name;
  });

  const tableData = ref<TableData | null>(null);
  const loadError = ref<string | null>(null);

  const pageTitle = computed(() => {
    const runName = tableData.value?.metadata.runName;
    return runName ? `Sample sheet — ${runName}` : 'Sample sheet';
  });

  usePageTitle(pageTitle);

  onMounted(async () => {
    try {
      const { url, pipelineOrWorkflowName, platform, runName } = route.query;

      if (!labId || !url) {
        throw new Error('Missing required parameters');
      }

      const fileDownloadUrlResponse = await $api.file.requestFileDownloadUrl({
        LaboratoryId: labId,
        S3Uri: url as string,
      });
      const content = await (await fetch(fileDownloadUrlResponse.DownloadUrl)).text();

      if (!content) {
        throw new Error('No content received');
      }

      const rows = content
        .trim()
        .split('\n')
        .map((line) => line.split(',').map((cell) => cell.trim()));

      const [headers, ...data] = rows;

      tableData.value = {
        headers,
        data,
        metadata: {
          labName: labName.value,
          pipelineOrWorkflowName: pipelineOrWorkflowName as string,
          platform: platform as string,
          runName: runName as string,
        },
      };
    } catch (error) {
      console.error('Error:', error);
      loadError.value = 'Unable to load sample sheet. Close this tab and try again from the run.';
    }
  });
</script>

<template>
  <div class="sample-sheet">
    <div v-if="loadError" role="alert" class="text-alert-danger">{{ loadError }}</div>

    <template v-else-if="tableData">
      <h1 class="text-heading mb-4 text-2xl font-semibold">Sample Sheet</h1>
      <dl class="mb-8 space-y-1">
        <div class="flex gap-2 text-sm">
          <dt class="font-medium">Laboratory</dt>
          <dd>{{ tableData.metadata.labName }}</dd>
        </div>
        <div class="flex gap-2 text-sm">
          <dt class="font-medium">Platform</dt>
          <dd>{{ tableData.metadata.platform }}</dd>
        </div>
        <div class="flex gap-2 text-sm">
          <dt class="font-medium">Pipeline</dt>
          <dd>{{ tableData.metadata.pipelineOrWorkflowName }}</dd>
        </div>
        <div class="flex gap-2 text-sm">
          <dt class="font-medium">Run name</dt>
          <dd>{{ tableData.metadata.runName }}</dd>
        </div>
      </dl>

      <div class="overflow-x-auto">
        <table :aria-label="`Sample sheet data for run ${tableData.metadata.runName}`">
          <caption class="sr-only">
            Sample sheet with {{ tableData.data.length }} rows and {{ tableData.headers.length }} columns
          </caption>
          <thead>
            <tr>
              <th v-for="header in tableData.headers" :key="header" scope="col">{{ header }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in tableData.data" :key="index">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-else role="status" aria-live="polite" class="text-muted">Loading sample sheet…</div>
  </div>
</template>

<style scoped>
  .sample-sheet {
    padding: 32px;
  }

  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 0 0 1px #e5e5e5;
    font-size: 14px;
  }

  th,
  td {
    padding: 16px;
    text-align: left;
    border-bottom: 1px solid #e5e5e5;
  }

  th,
  tr td:first-child {
    background: #f7f7f7;
    font-weight: 600;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr td:not(:last-child),
  tr th:not(:last-child) {
    border-right: 1px solid #e5e5e5;
  }

  td {
    background: white;
  }
</style>
