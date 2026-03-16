/**
 * This abstract class helps ensure the services implementation adheres to
 * the minimum required functions to ensure code consistency.
 */
export abstract class Service {
  // Create operation
  public async add<T>(object: T): Promise<T>; // Put Item

  // Read operations
  public async get<T>(hashKey: string, sortKey?: string): Promise<T | undefined>; // Get Item

  public async query?<T>(gsi: string): Promise<T>; // Querying by GSI (optional)

  public async list?<T>(): Promise<T[]>; // Scan Items

  // Update operations
  public async update<T>(object: T, existing?: T): Promise<T>; // Update Item

  // Delete operation
  public async delete<T>(object: T): Promise<boolean>; // Delete Item
}