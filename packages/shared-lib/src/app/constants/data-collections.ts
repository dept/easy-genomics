export const DATA_COLLECTION_TAG_NAME_MAX_LENGTH = 40;
export const DATA_COLLECTION_BATCH_NAME_MAX_LENGTH = 250;
export const SAMPLE_NAME_MAX_LENGTH = 250;
export const SEQUENCE_COLLECTION_NAME_MAX_LENGTH = 250;

/** Preset swatch colors offered when creating a data tag. */
export const TAG_PRESET_COLORS = ['#5B4FD4', '#85B7EB', '#F09595', '#97C459', '#ED93B1', '#EF9F27', '#B4B2A9'] as const;

/** Default tag color when none is chosen (first preset). */
export const DEFAULT_TAG_COLOR: string = TAG_PRESET_COLORS[0];
