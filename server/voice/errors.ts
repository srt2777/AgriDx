/** Errors with a client-facing status/code; never include provider internals. */
export class VoiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'VoiceError';
  }
}
