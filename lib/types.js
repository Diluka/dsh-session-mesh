/// <reference path="../types/host.d.ts" />

export class SessionMeshError extends Error {
  /** @type {SendSessionMessageErrorCode} */
  code

  /**
   * @param {SendSessionMessageErrorCode} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'SessionMeshError'
    this.code = code
  }
}
