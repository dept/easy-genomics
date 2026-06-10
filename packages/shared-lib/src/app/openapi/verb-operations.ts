import { AssociativeArray, HttpRequest } from '../utils/common';

export const LAMBDA_FUNCTION_ROOT_DIR = 'src/app/controllers'; // DO NOT CHANGE

// Copied from packages/back-end/src/infra/constructs/lambda-construct.ts
// Keep in sync — if the construct tables change, update this file and regenerate the spec.
// List of allowed "CRUD" Lambda Function operations with respective REST API command mapping
export const ALLOWED_LAMBDA_FUNCTION_OPERATIONS: AssociativeArray<HttpRequest> = {
  ['create']: 'POST',
  ['confirm']: 'POST',
  ['list']: 'GET', // List multiple records
  ['read']: 'GET',
  ['update']: 'PUT',
  ['cancel']: 'PUT',
  ['patch']: 'PATCH',
  ['delete']: 'DELETE',
  // Additional Lambda Function operations for managing objects by using the Posted Hash/Partition Key & Sort Key
  ['add']: 'POST',
  ['edit']: 'POST',
  ['request']: 'POST',
  ['remove']: 'POST',
};

// Copied from packages/back-end/src/infra/constructs/lambda-construct.ts
// Keep in sync — if the construct tables change, update this file and regenerate the spec.
// List of allowed Lambda Function operations requiring path parameter 'id' for specific resource
export const ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID: AssociativeArray<HttpRequest> = {
  ['read']: 'GET', // Read specific record
  ['update']: 'PUT', // Update specific record
  ['cancel']: 'PUT', // Update specific record
  ['patch']: 'PATCH', // Patch specific record
  ['delete']: 'DELETE', // Delete specific record
};
