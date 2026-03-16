/**
 * This abstract class helps ensure the services implementation adheres to
 * the minimum required functions to ensure code consistency.
 */
export abstract class Service<T = unknown> {
  // Create operation
  public abstract add(object: T): Promise<T>; // Put Item

  // Read operations
  public abstract get(hashKey: string, sortKey?: string): Promise<T | undefined>; // Get Item

  public async query?(gsi: string): Promise<T>; // Querying by GSI (optional)

  public async list?(): Promise<T[]>; // Scan Items

  // Update operations
  public abstract update(object: T, existing?: T): Promise<T>; // Update Item

  // Delete operation
  public abstract delete(object: T): Promise<boolean>; // Delete Item
}