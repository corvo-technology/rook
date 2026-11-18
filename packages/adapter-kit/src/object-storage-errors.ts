/** The object storage has no object under this key. Provider adapters translate their own "not found". */
export class ObjectNotFoundError extends Error {
  readonly code = "OBJECT_NOT_FOUND";
  constructor(
    readonly key: string,
    options?: { cause?: unknown },
  ) {
    super(`No object stored under ${key}`, options);
    this.name = "ObjectNotFoundError";
  }
}

/**
 * The organization's plan has no room left for this upload or save. Nothing is deleted: the
 * caller keeps what it has, and the same write succeeds once space is freed or the plan grows.
 */
export class StorageQuotaError extends Error {
  readonly code = "STORAGE_QUOTA_EXCEEDED";
  constructor(
    readonly usedBytes: number,
    readonly limitBytes: number,
  ) {
    super("Storage is full for this plan.");
    this.name = "StorageQuotaError";
  }
}
