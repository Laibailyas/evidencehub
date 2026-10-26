import type { TranslationKey } from '../i18n/translations';

export class UploadValidationError extends Error {
  constructor(public readonly translationKey: TranslationKey) {
    super('Upload validation failed');
    this.name = 'UploadValidationError';
  }
}

// Exact backend validation messages only; never forward response text to the UI.
const uploadErrors: Record<string, TranslationKey> = {
  'file must be a valid PDF': 'form.upload.invalid_pdf',
  'file must be a valid DOCX document': 'form.upload.invalid_docx',
  'only PDF and DOCX files are supported': 'form.upload.invalid',
  'invalid upload': 'form.upload.unreadable',
  'invalid file encoding': 'form.upload.unreadable',
  'could not read uploaded document': 'form.upload.unreadable',
  'could not extract text from uploaded document': 'form.upload.unreadable',
};

export async function projectUploadError(response: Response, hasProjectUpload: boolean): Promise<Error> {
  if (hasProjectUpload && (response.status === 400 || response.status === 413)) {
    try {
      const body: unknown = await response.json();
      const message = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
      if (typeof message === 'string') {
        const key = response.status === 400
          ? (Object.prototype.hasOwnProperty.call(uploadErrors, message) ? uploadErrors[message] : undefined)
          : message === 'file too large (maximum 4 MB)' ? 'form.upload.too_large'
          : message === 'file too large or empty' ? 'form.upload.empty_or_large' : undefined;
        if (key) return new UploadValidationError(key);
      }
    } catch {
      // Malformed/non-JSON responses retain the generic status-only error.
    }
  }
  return new Error(`API request failed (${response.status})`);
}

export function projectSubmitErrorKey(error: unknown): TranslationKey {
  return error instanceof UploadValidationError ? error.translationKey : 'form.submit_error';
}
