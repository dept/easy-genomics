import {
  DeleteItemCommandOutput,
  PutItemCommandOutput,
  QueryCommandOutput,
  GetItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  WorkflowRunPresetLimitReachedError,
  WorkflowRunPresetNameTakenError,
  WorkflowRunPresetNotFoundError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { WorkflowRunPresetSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-run-preset';
import {
  ListWorkflowRunPresetsResponse,
  omitRunSpecificParams,
  WorkflowRunPreset,
  WorkflowRunPresetParams,
  WorkflowRunPresetScope,
  WORKFLOW_RUN_PRESET_LIMIT,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-run-preset';
import { v4 as uuidv4 } from 'uuid';
import { Service } from '../../types/service';
import { labPresetKeyPrefix, userPresetKeyPrefix, workflowRunPresetKey } from '../../utils/workflow-run-preset-utils';
import { DynamoDBService } from '../dynamodb-service';

function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

function hasNameCollision(presets: WorkflowRunPreset[], name: string): boolean {
  return presets.some((preset) => normaliseName(preset.Name) === normaliseName(name));
}

function byName(a: WorkflowRunPreset, b: WorkflowRunPreset): number {
  return a.Name.localeCompare(b.Name);
}

export interface WorkflowRunPresetOwner {
  LaboratoryId: string;
  WorkflowId: string;
  Scope: WorkflowRunPresetScope;
  /** Cognito user making the request; identifies the owner of `USER` scoped presets. */
  UserId: string;
}

export class WorkflowRunPresetService extends DynamoDBService implements Service<WorkflowRunPreset> {
  readonly WORKFLOW_RUN_PRESET_TABLE_NAME: string = `${process.env.NAME_PREFIX}-workflow-run-preset-table`;

  public constructor() {
    super();
  }

  // ── Domain operations ───────────────────────────────────────────────────────

  /** Both tiers a lab member may pick from when configuring a run of this workflow. */
  public listForWorkflow = async (
    laboratoryId: string,
    userId: string,
    workflowId: string,
  ): Promise<ListWorkflowRunPresetsResponse> => {
    const [userPresets, labPresets] = await Promise.all([
      this.listUserPresets(laboratoryId, userId, workflowId),
      this.listLabPresets(laboratoryId, workflowId),
    ]);

    return {
      UserPresets: userPresets.sort(byName),
      LabPresets: labPresets.sort(byName),
    };
  };

  public createPreset = async (
    owner: WorkflowRunPresetOwner,
    name: string,
    params: WorkflowRunPresetParams,
    createdByEmail?: string,
  ): Promise<WorkflowRunPreset> => {
    const siblings: WorkflowRunPreset[] = await this.listSiblings(owner);

    if (siblings.length >= WORKFLOW_RUN_PRESET_LIMIT) {
      throw new WorkflowRunPresetLimitReachedError(WORKFLOW_RUN_PRESET_LIMIT);
    }
    if (hasNameCollision(siblings, name)) {
      throw new WorkflowRunPresetNameTakenError();
    }

    const presetId: string = uuidv4();
    const createdAt: string = new Date().toISOString();

    return this.add({
      LaboratoryId: owner.LaboratoryId,
      PresetKey: workflowRunPresetKey(owner.Scope, owner.UserId, owner.WorkflowId, presetId),
      PresetId: presetId,
      Scope: owner.Scope,
      WorkflowId: owner.WorkflowId,
      Name: name.trim(),
      Params: omitRunSpecificParams(params),
      CreatedAt: createdAt,
      CreatedBy: owner.UserId,
      CreatedByEmail: createdByEmail,
      ModifiedAt: createdAt,
      ModifiedBy: owner.UserId,
    });
  };

  public updatePreset = async (
    owner: WorkflowRunPresetOwner,
    presetId: string,
    changes: { Name?: string; Params?: WorkflowRunPresetParams },
  ): Promise<WorkflowRunPreset> => {
    const presetKey: string = workflowRunPresetKey(owner.Scope, owner.UserId, owner.WorkflowId, presetId);
    const existing: WorkflowRunPreset | undefined = await this.get(owner.LaboratoryId, presetKey);
    if (!existing) {
      throw new WorkflowRunPresetNotFoundError(presetId);
    }

    if (changes.Name !== undefined) {
      const siblings: WorkflowRunPreset[] = (await this.listSiblings(owner)).filter(
        (sibling) => sibling.PresetId !== presetId,
      );
      if (hasNameCollision(siblings, changes.Name)) {
        throw new WorkflowRunPresetNameTakenError();
      }
    }

    return this.update({
      ...existing,
      Name: changes.Name?.trim() ?? existing.Name,
      Params: changes.Params ? omitRunSpecificParams(changes.Params) : existing.Params,
      ModifiedAt: new Date().toISOString(),
      ModifiedBy: owner.UserId,
    });
  };

  public deletePreset = async (owner: WorkflowRunPresetOwner, presetId: string): Promise<boolean> => {
    const presetKey: string = workflowRunPresetKey(owner.Scope, owner.UserId, owner.WorkflowId, presetId);
    const existing: WorkflowRunPreset | undefined = await this.get(owner.LaboratoryId, presetKey);
    if (!existing) {
      throw new WorkflowRunPresetNotFoundError(presetId);
    }

    return this.delete(existing);
  };

  // ── Table operations ────────────────────────────────────────────────────────

  public add = async (preset: WorkflowRunPreset): Promise<WorkflowRunPreset> => {
    const logRequestMessage = `Add WorkflowRunPreset LaboratoryId=${preset.LaboratoryId}, PresetKey=${preset.PresetKey}`;
    console.info(logRequestMessage);

    if (!WorkflowRunPresetSchema.safeParse(preset).success) {
      throw new Error('Invalid request');
    }

    const response: PutItemCommandOutput = await this.putItem({
      TableName: this.WORKFLOW_RUN_PRESET_TABLE_NAME,
      ConditionExpression: 'attribute_not_exists(#LaboratoryId) AND attribute_not_exists(#PresetKey)',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId',
        '#PresetKey': 'PresetKey',
      },
      Item: marshall(preset, { removeUndefinedValues: true }),
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP ${response.$metadata.httpStatusCode}`);
    }

    return preset;
  };

  public get = async (laboratoryId: string, presetKey?: string): Promise<WorkflowRunPreset | undefined> => {
    const logRequestMessage = `Get WorkflowRunPreset LaboratoryId=${laboratoryId}, PresetKey=${presetKey}`;
    console.info(logRequestMessage);

    const response: GetItemCommandOutput = await this.getItem({
      TableName: this.WORKFLOW_RUN_PRESET_TABLE_NAME,
      Key: {
        LaboratoryId: { S: laboratoryId },
        PresetKey: { S: presetKey! },
      },
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP ${response.$metadata.httpStatusCode}`);
    }

    if (!response.Item) {
      return undefined;
    }

    return <WorkflowRunPreset>unmarshall(response.Item);
  };

  /** Presets the given user saved for themselves against this laboratory + workflow. */
  public listUserPresets = async (
    laboratoryId: string,
    userId: string,
    workflowId: string,
  ): Promise<WorkflowRunPreset[]> => {
    return this.listByKeyPrefix(laboratoryId, userPresetKeyPrefix(userId, workflowId));
  };

  /** Presets shared with every member of this laboratory for this workflow. */
  public listLabPresets = async (laboratoryId: string, workflowId: string): Promise<WorkflowRunPreset[]> => {
    return this.listByKeyPrefix(laboratoryId, labPresetKeyPrefix(workflowId));
  };

  /**
   * A preset is a small self-contained item, so updates rewrite it whole rather than
   * building a partial SET expression. The condition keeps the write from resurrecting
   * a preset that was deleted between the caller's read and this write.
   */
  public update = async (preset: WorkflowRunPreset): Promise<WorkflowRunPreset> => {
    const logRequestMessage = `Update WorkflowRunPreset LaboratoryId=${preset.LaboratoryId}, PresetKey=${preset.PresetKey}`;
    console.info(logRequestMessage);

    if (!WorkflowRunPresetSchema.safeParse(preset).success) {
      throw new Error('Invalid request');
    }

    const response: PutItemCommandOutput = await this.putItem({
      TableName: this.WORKFLOW_RUN_PRESET_TABLE_NAME,
      ConditionExpression: 'attribute_exists(#LaboratoryId) AND attribute_exists(#PresetKey)',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId',
        '#PresetKey': 'PresetKey',
      },
      Item: marshall(preset, { removeUndefinedValues: true }),
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP ${response.$metadata.httpStatusCode}`);
    }

    return preset;
  };

  public delete = async (preset: WorkflowRunPreset): Promise<boolean> => {
    const logRequestMessage = `Delete WorkflowRunPreset LaboratoryId=${preset.LaboratoryId}, PresetKey=${preset.PresetKey}`;
    console.info(logRequestMessage);

    const response: DeleteItemCommandOutput = await this.deleteItem({
      TableName: this.WORKFLOW_RUN_PRESET_TABLE_NAME,
      Key: {
        LaboratoryId: { S: preset.LaboratoryId },
        PresetKey: { S: preset.PresetKey },
      },
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP ${response.$metadata.httpStatusCode}`);
    }

    return true;
  };

  /** Presets competing for the same name and the same per-workflow cap as `owner`. */
  private listSiblings = async (owner: WorkflowRunPresetOwner): Promise<WorkflowRunPreset[]> => {
    return owner.Scope === 'LAB'
      ? this.listLabPresets(owner.LaboratoryId, owner.WorkflowId)
      : this.listUserPresets(owner.LaboratoryId, owner.UserId, owner.WorkflowId);
  };

  private listByKeyPrefix = async (laboratoryId: string, presetKeyPrefix: string): Promise<WorkflowRunPreset[]> => {
    const logRequestMessage = `Query WorkflowRunPresets LaboratoryId=${laboratoryId}, PresetKeyPrefix=${presetKeyPrefix}`;
    console.info(logRequestMessage);

    const response: QueryCommandOutput = await this.queryItems({
      TableName: this.WORKFLOW_RUN_PRESET_TABLE_NAME,
      KeyConditionExpression: '#LaboratoryId = :laboratoryId AND begins_with(#PresetKey, :presetKeyPrefix)',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId',
        '#PresetKey': 'PresetKey',
      },
      ExpressionAttributeValues: {
        ':laboratoryId': { S: laboratoryId },
        ':presetKeyPrefix': { S: presetKeyPrefix },
      },
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP ${response.$metadata.httpStatusCode}`);
    }

    if (!response.Items?.length) {
      return [];
    }

    return response.Items.map((item) => <WorkflowRunPreset>unmarshall(item));
  };
}
