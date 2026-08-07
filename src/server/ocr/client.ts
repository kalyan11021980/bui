/** Shared error type for the OCR transports. */

export class OcrError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'OcrError'
  }
}