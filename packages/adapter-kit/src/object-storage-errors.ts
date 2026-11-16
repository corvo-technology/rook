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
