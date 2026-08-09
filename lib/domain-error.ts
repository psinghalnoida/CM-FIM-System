import "server-only";

/**
 * An expected, client-correctable business-rule violation — "you can't do
 * that because X" — as opposed to a bug. Domain services throw this (not
 * a plain Error) for conditions like "incident is already closed" or
 * "this document link type isn't supported yet", so
 * lib/api-errors.ts's toApiErrorResponse() can map it to a real 4xx
 * instead of falling through to a generic 500 — which is what happens to
 * a plain `throw new Error(...)`, and is misleading to an API caller: it
 * looks like a server bug, not a rule they can act on.
 */
export class DomainError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "DomainError";
    this.status = status;
  }
}
