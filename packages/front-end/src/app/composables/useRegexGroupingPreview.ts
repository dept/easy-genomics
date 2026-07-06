import {
  groupFilenamesByRegex,
  type ProposedSample,
} from '@easy-genomics/shared-lib/src/app/utils/sample-regex-grouping';

export default function useRegexGroupingPreview(fileNames: Ref<string[]>, regexPattern: Ref<string>) {
  const proposedSets = ref<ProposedSample[]>([]);
  const unmatchedFiles = ref<string[]>([]);

  function refreshPreview(): void {
    const { sets, unmatched } = groupFilenamesByRegex(fileNames.value, regexPattern.value);
    proposedSets.value = sets;
    unmatchedFiles.value = unmatched;
  }

  function resetPreview(): void {
    proposedSets.value = [];
    unmatchedFiles.value = [];
  }

  watch(regexPattern, () => refreshPreview());
  watch(fileNames, () => refreshPreview());

  return { proposedSets, unmatchedFiles, refreshPreview, resetPreview };
}
