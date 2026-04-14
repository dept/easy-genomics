<script setup lang="ts">
  interface ActionItem {
    label: string;
    click: Function;
  }

  export type TableSort = { column: string; direction: 'asc' | 'desc' };

  const props = withDefaults(
    defineProps<{
      tableData: any[];
      columns: any[];
      isLoading?: boolean;
      actionItems?: () => ActionItem[];
      showPagination?: boolean;
      rowClickAction?: (rowItem: any) => void | undefined;
      noResultsMsg?: string;
      canSelect?: boolean;
      rowClasses?: (row: any) => string;
      /**
       * Name + Description columns share remaining width; Run and Favourite (last two) stay narrow.
       * Use when columns are [Name, Description, run, favourite] in that order.
       */
      narrowRunAndFavouriteColumns?: boolean;
    }>(),
    {
      showPagination: true,
      noResultsMsg: 'No results found',
      narrowRunAndFavouriteColumns: false,
    },
  );

  const sort = defineModel<TableSort>('sort');

  const page = ref(1);
  const rowsPerPage = ref(10);
  const selected = props.canSelect ? ref([]) : ref(null);

  const end = computed(() => Math.min(start.value + rowsPerPage.value, totalRows.value));
  const rows = computed(() => {
    if (totalRows.value > 0) return props.tableData.slice(start.value, end.value);
    return [];
  });
  const showingResultsMsg = computed(() => {
    if (totalRows.value > 0) {
      return `Showing ${start.value + 1}-${end.value} of ${totalRows.value} results`;
    }
    return '';
  });
  const start = computed(() => (page.value - 1) * rowsPerPage.value);
  const totalRows = computed(() => props.tableData.length || 0);
  const totalPages = computed(() => Math.ceil(totalRows.value / rowsPerPage.value));

  watch(
    page,
    (newPage) => {
      if (newPage < 1) page.value = 1;
      else if (totalPages.value > 0 && newPage > totalPages.value) page.value = totalPages.value;
    },
    { immediate: true, flush: 'sync' },
  );

  watch(
    () => props.tableData,
    (_newTableData: any) => {
      // when table data changes, reset to page 1
      page.value = 1;
    },
    { immediate: true },
  );
</script>

<template>
  <UCard
    class="rounded-2xl border-none shadow-none"
    :class="{ 'eg-table--narrow-run-favourite': narrowRunAndFavouriteColumns }"
    :ui="{ body: 'p-0' }"
  >
    <UTable
      :ui="{
        tr: {
          active: ` ${rowClickAction ? 'hover:bg-gray-50 cursor-pointer' : 'hover:bg-white cursor-default'}`,
        },
      }"
      @select="rowClickAction ? rowClickAction($event) : undefined"
      class="rounded-2xl"
      :rows="rows"
      :columns="columns"
      v-model:sort="sort"
      sort-mode="manual"
      :loading="isLoading"
      :loading-state="{ icon: '', label: '' }"
      v-model="selected"
    >
      <!-- Custom columns can be passed in as slots from parent -->
      <template v-for="(_, slotName) in $slots" #[slotName]="slotData">
        <slot :name="slotName" v-bind="slotData"></slot>
      </template>

      <template #default="{ row }">
        <tr :class="props.rowClasses ? props.rowClasses(row) : ''">
          <td v-for="(column, index) in columns" :key="index">
            <slot :name="column.key + '-data'" :row="row">{{ row[column.key] }}</slot>
          </td>
        </tr>
      </template>

      <template #actions-data="{ row }">
        <EGActionButton v-if="actionItems" :items="actionItems(row)" @click="$event.stopPropagation()" />
      </template>

      <template #empty-state>
        <div class="text-muted flex h-12 items-center justify-center font-normal" v-if="!isLoading">
          {{ noResultsMsg }}
        </div>
      </template>
    </UTable>
  </UCard>

  <div
    class="text-muted flex h-16 flex-wrap items-center justify-between"
    v-if="showPagination && rowsPerPage > 1 && !isLoading"
  >
    <div class="text-xs leading-5">{{ showingResultsMsg }}</div>
    <div class="flex justify-end px-3" v-if="totalRows > rowsPerPage">
      <UPagination v-model="page" :page-count="rowsPerPage" :total="totalRows" />
    </div>
  </div>
</template>

<style scoped lang="scss">
  :deep(table) {
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    width: 100%;
    table-layout: auto;

    thead {
      button {
        color: black;
      }

      tr {
        background-color: #efefef;

        th:first-child {
          padding-left: 40px;
          width: 320px;
        }

        th:not(:only-child):last-child {
          text-align: right;
          padding-right: 40px;
        }
      }
    }

    tbody tr {
      td {
        padding-top: 22px;
        padding-bottom: 22px;
      }
    }

    tbody tr td:nth-child(1) {
      color: black;
      font-weight: 500;
      padding-left: 40px;
      white-space: normal;
    }

    tbody tr td:not(:first-child) {
      font-size: 12px;
      color: #818181;
      white-space: normal;
    }

    tbody tr td:not(:only-child):last-child {
      width: 50px;
      padding-right: 40px;
      text-align: right;
    }
  }

  /*
   * Name + Description flexible; Run + Favourite narrow and centered.
   * Do NOT use display:flex on th/td — it breaks table layout and stacks columns.
   */
  .eg-table--narrow-run-favourite :deep(table) {
    table-layout: fixed;
    width: 100%;

    thead tr th:first-child {
      width: 34%;
      min-width: 0;
      padding-left: 40px;
      text-align: left;
    }

    thead tr th:nth-child(2) {
      width: auto;
      min-width: 0;
      text-align: left;
    }

    thead tr th:nth-child(3),
    thead tr th:nth-child(4),
    tbody tr td:nth-child(3),
    tbody tr td:nth-child(4) {
      text-align: center !important;
      vertical-align: middle;
      padding-top: 0.875rem;
      padding-bottom: 0.875rem;
      padding-left: 0.75rem;
      padding-right: 0.75rem;
      box-sizing: border-box;
    }

    thead tr th:nth-child(3),
    tbody tr td:nth-child(3) {
      width: 5.5rem;
    }

    thead tr th:nth-child(4),
    tbody tr td:nth-child(4) {
      width: 9.5rem;
      white-space: nowrap;
    }

    thead tr th:nth-child(3) button,
    thead tr th:nth-child(4) button {
      margin-left: auto;
      margin-right: auto;
    }

    tbody tr td:nth-child(1) {
      width: 34%;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    tbody tr td:nth-child(2) {
      width: auto;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    /* Icon buttons in body: block + auto margins centers under the header text */
    tbody tr td:nth-child(3) button,
    tbody tr td:nth-child(4) button {
      display: inline-flex;
      margin-left: auto;
      margin-right: auto;
    }
  }
</style>
