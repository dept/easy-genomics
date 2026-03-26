import { CreateLaboratory, UpdateLaboratory } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory';
import { LaboratoryRunSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import { RemoveLaboratoryUserSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-user';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { LaboratoryUserDetails } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user-details';
import { z } from 'zod';
import HttpFactory from '@FE/repository/factory';
import { DeletedResponse, EditUserResponse } from '@FE/types/api';
import { validateApiResponse } from '@FE/utils/api-utils';

class LabsModule extends HttpFactory {
  async create(lab: CreateLaboratory): Promise<Laboratory | undefined> {
    const res = await this.call<Laboratory>('POST', '/laboratory/create-laboratory', lab);

    if (!res) {
      throw new Error('Failed to create Laboratory');
    }

    return res;
  }

  /**
   * List all laboratories for an organization
   * @param orgId
   */
  async list(orgId: string): Promise<Laboratory[]> {
    const res = await this.call<Laboratory[]>('GET', `/laboratory/list-laboratories?organizationId=${orgId}`);

    if (!res) {
      throw new Error('Failed to retrieve Laboratory');
    }

    return res;
  }

  /**
   * Get a Laboratory's details
   * @param labId
   */
  async labDetails(labId: string): Promise<Laboratory> {
    const res = await this.call<Laboratory>('GET', `/laboratory/read-laboratory/${labId}`);

    if (!res) {
      throw new Error('Failed to retrieve Laboratory Details');
    }

    return res;
  }

  /**
   * Update a Laboratory
   * @param labId
   * @param lab
   */
  async update(labId: string, lab: UpdateLaboratory): Promise<Laboratory> {
    const res = await this.call<Laboratory>('PUT', `/laboratory/update-laboratory/${labId}`, lab);

    if (!res) {
      throw new Error('Failed to update Laboratory');
    }

    return res;
  }

  /**
   * Delete a laboratory
   * @param labId
   */
  async delete(labId: string): Promise<DeletedResponse> {
    const res = await this.call<DeletedResponse>('DELETE', `/laboratory/delete-laboratory/${labId}`);

    if (!res) {
      throw new Error('Failed to delete Laboratory');
    }

    return res;
  }

  /**
   * Add a user to a laboratory
   * @param labId
   * @param userId
   */
  async addLabUser(labId: string, userId: string): Promise<EditUserResponse> {
    const res = await this.call<EditUserResponse>('POST', '/laboratory/user/add-laboratory-user', {
      LaboratoryId: labId,
      UserId: userId,
      Status: 'Active',
      LabManager: false,
      LabTechnician: true,
    });

    if (!res) {
      throw new Error('Failed to edit Laboratory user');
    }

    return res;
  }

  /**
   * Edit a user's access in a laboratory
   * @param labId
   * @param userId
   * @param isLabManager
   */
  async editUserLabAccess(labId: string, userId: string, isLabManager: boolean): Promise<EditUserResponse> {
    const res = await this.call<EditUserResponse>('POST', '/laboratory/user/edit-laboratory-user', {
      LaboratoryId: labId,
      UserId: userId,
      Status: 'Active',
      LabManager: isLabManager,
      LabTechnician: !isLabManager,
    });

    if (!res) {
      throw new Error("Failed to edit user's Laboratory access");
    }

    return res;
  }

  /**
   * List all users in a Laboratory
   * @param labId
   */
  async listLabUsersByLabId(labId: string): Promise<LaboratoryUser[]> {
    const res = await this.call<LaboratoryUser[]>(
      'GET',
      `/laboratory/user/list-laboratory-users?laboratoryId=${labId}`,
    );

    if (!res) {
      throw new Error('Failed to retrieve Laboratory users');
    }

    return res;
  }

  /**
   * List all Laboratories for a user
   * @param userId
   */
  async listLabUsersByUserId(userId: string): Promise<LaboratoryUser[]> {
    const res = await this.call<LaboratoryUser[]>('GET', `/laboratory/user/list-laboratory-users?userId=${userId}`);

    if (!res) {
      throw new Error('Failed to retrieve Laboratory users');
    }

    return res;
  }

  /**
   * Remove a user from a Laboratory
   * @param labId
   * @param userId
   */
  async removeUser(labId: string, userId: string): Promise<DeletedResponse> {
    const input = {
      LaboratoryId: labId,
      UserId: userId,
    };

    try {
      RemoveLaboratoryUserSchema.parse(input);
    } catch (error) {
      throw new Error(`Validation failed: ${error}`);
    }

    const res = await this.call<DeletedResponse>('POST', '/laboratory/user/remove-laboratory-user', {
      LaboratoryId: labId,
      UserId: userId,
    });

    if (!res) {
      throw new Error('Failed to remove user from Laboratory');
    }

    return res;
  }

  /**
   * Get details for all a Laboratory users
   * @param labId
   */
  async usersDetails(labId: string): Promise<LaboratoryUserDetails[]> {
    const res = await this.call<LaboratoryUserDetails[]>(
      'GET',
      `/laboratory/user/list-laboratory-users-details?laboratoryId=${labId}`,
    );

    if (!res) {
      throw new Error('Failed to retrieve Laboratory users details');
    }

    return res;
  }

  async listLabRuns(labId: string, filters: object = {}): Promise<LaboratoryRun[]> {
    let queryUrl = `/laboratory/run/list-laboratory-runs?LaboratoryId=${labId}`;

    for (const [filterKey, filterVal] of Object.entries(filters)) queryUrl += `&${filterKey}=${filterVal}`;

    const res = await this.call<LaboratoryRun[]>('GET', queryUrl);

    if (!res) {
      throw new Error('Failed to retrieve Laboratory runs');
    }

    const LaboratoryRunArraySchema = z.array(LaboratoryRunSchema); // Define an array schema
    validateApiResponse(LaboratoryRunArraySchema, res);
    return res;
  }

  async createLabRun(labRunRequest: LaboratoryRun): Promise<LaboratoryRun> {
    const res = await this.call<any>('POST', '/laboratory/run/create-laboratory-run', labRunRequest);
    if (!res) {
      console.error('Error calling create pipeline run API');
      throw new Error('Failed to create pipeline run');
    }

    validateApiResponse(LaboratoryRunSchema, res);
    return res;
  }

  async updateLabRun(runId: string, labRunRequest: LaboratoryRun): Promise<LaboratoryRun> {
    const res = await this.call<any>('PUT', `/laboratory/run/update-laboratory-run/${runId}`, labRunRequest);
    if (!res) {
      console.error('Error calling edit laboratory run API');
      throw new Error('Failed to edit laboratory run');
    }

    validateApiResponse(LaboratoryRunSchema, res);
    return res;
  }

  /**
   *  Request status check on all runs not in a terminal state
   *  @param labId
   *  @param runIds
   */
  async requestLabRunStatusCheck(labId: string, runIds: string[]) {
    const res = await this.call<any>(
      'POST',
      `/laboratory/run/request-laboratory-run-status-check?laboratoryId=${labId}`,
      { runIds },
    );
    if (!res) {
      throw new Error('Failed to request lab run status check');
    }
    return res;
  }
}

export default LabsModule;
