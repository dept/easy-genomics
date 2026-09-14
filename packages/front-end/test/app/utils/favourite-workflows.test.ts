import { FavouriteWorkflow } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import {
  LabWorkflowAvailability,
  getFavouriteWorkflowState,
  pruneMissingFavouriteWorkflows,
  selectVisibleFavouriteWorkflows,
} from '../../../src/app/utils/favourite-workflows';

const LAB_ID = 'a1b2c3d4-0000-0000-0000-000000000001';
const OTHER_LAB_ID = 'a1b2c3d4-0000-0000-0000-000000000002';

function omicsFavourite(workflowId: string, laboratoryId: string = LAB_ID): FavouriteWorkflow {
  return {
    WorkflowId: workflowId,
    WorkflowName: `Workflow ${workflowId}`,
    Platform: 'AWS HealthOmics',
    LaboratoryId: laboratoryId,
  };
}

function seqeraFavourite(workflowId: string, laboratoryId: string = LAB_ID): FavouriteWorkflow {
  return {
    WorkflowId: workflowId,
    WorkflowName: `Pipeline ${workflowId}`,
    Platform: 'Seqera Cloud',
    LaboratoryId: laboratoryId,
  };
}

function availability(
  omics: LabWorkflowAvailability['AWS HealthOmics'],
  seqera: LabWorkflowAvailability['Seqera Cloud'] = { state: 'unknown' },
): LabWorkflowAvailability {
  return { 'AWS HealthOmics': omics, 'Seqera Cloud': seqera };
}

describe('getFavouriteWorkflowState', () => {
  it('is available when the live list contains the workflow', () => {
    const state = getFavouriteWorkflowState(
      omicsFavourite('1234'),
      availability({ state: 'loaded', workflowIds: new Set(['1234', '5678']) }),
    );
    expect(state).toBe('available');
  });

  it('is missing when the live list was loaded without the workflow', () => {
    const state = getFavouriteWorkflowState(
      omicsFavourite('1234'),
      availability({ state: 'loaded', workflowIds: new Set(['5678']) }),
    );
    expect(state).toBe('missing');
  });

  it('is unknown when the live list could not be loaded', () => {
    expect(getFavouriteWorkflowState(omicsFavourite('1234'), availability({ state: 'unknown' }))).toBe('unknown');
  });

  it('is platform-disabled when the lab no longer has the platform enabled', () => {
    expect(getFavouriteWorkflowState(omicsFavourite('1234'), availability({ state: 'disabled' }))).toBe(
      'platform-disabled',
    );
  });

  it('checks each favourite against its own platform', () => {
    const labAvailability = availability(
      { state: 'loaded', workflowIds: new Set(['1234']) },
      { state: 'loaded', workflowIds: new Set(['42']) },
    );

    expect(getFavouriteWorkflowState(omicsFavourite('42'), labAvailability)).toBe('missing');
    expect(getFavouriteWorkflowState(seqeraFavourite('42'), labAvailability)).toBe('available');
  });
});

describe('selectVisibleFavouriteWorkflows', () => {
  it('hides favourites whose workflow was deleted, and favourites of other labs', () => {
    const favourites = [
      omicsFavourite('kept'),
      omicsFavourite('deleted'),
      omicsFavourite('kept', OTHER_LAB_ID),
      seqeraFavourite('disabled-platform'),
    ];

    const visible = selectVisibleFavouriteWorkflows(
      favourites,
      LAB_ID,
      availability({ state: 'loaded', workflowIds: new Set(['kept']) }, { state: 'disabled' }),
    );

    expect(visible).toEqual([omicsFavourite('kept')]);
  });

  it('keeps showing favourites when the live list could not be loaded', () => {
    const favourites = [omicsFavourite('one'), omicsFavourite('two')];

    expect(selectVisibleFavouriteWorkflows(favourites, LAB_ID, availability({ state: 'unknown' }))).toEqual(favourites);
  });
});

describe('pruneMissingFavouriteWorkflows', () => {
  it('removes only the deleted workflows of the given lab', () => {
    const favourites = [
      omicsFavourite('kept'),
      omicsFavourite('deleted'),
      omicsFavourite('deleted', OTHER_LAB_ID),
      seqeraFavourite('42'),
    ];

    const { retained, removed } = pruneMissingFavouriteWorkflows(
      favourites,
      LAB_ID,
      availability({ state: 'loaded', workflowIds: new Set(['kept']) }, { state: 'loaded', workflowIds: new Set() }),
    );

    expect(removed).toEqual([omicsFavourite('deleted'), seqeraFavourite('42')]);
    expect(retained).toEqual([omicsFavourite('kept'), omicsFavourite('deleted', OTHER_LAB_ID)]);
  });

  it('removes nothing when no live list was loaded', () => {
    const favourites = [omicsFavourite('one'), seqeraFavourite('42')];

    const { retained, removed } = pruneMissingFavouriteWorkflows(
      favourites,
      LAB_ID,
      availability({ state: 'unknown' }),
    );

    expect(removed).toEqual([]);
    expect(retained).toEqual(favourites);
  });

  it('keeps favourites of a platform the lab has disabled so they return with the platform', () => {
    const favourites = [omicsFavourite('one')];

    const { retained, removed } = pruneMissingFavouriteWorkflows(
      favourites,
      LAB_ID,
      availability({ state: 'disabled' }),
    );

    expect(removed).toEqual([]);
    expect(retained).toEqual(favourites);
  });
});
