import { google } from 'googleapis';
import { storeClearKBCache } from './store';

function getDocsAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var not set');
  const credentials = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/documents',
    ],
  });
}

function extractDocId(fileId: string): string | null {
  const match = fileId.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

/**
 * Replaces `originalExcerpt` text with `correctedContent` in the Google Doc
 * identified by `fileId`. Uses replaceAllText which is safe for serverless —
 * no need to locate specific paragraph indices.
 *
 * The Google Docs must be shared with the service account (client_email in the
 * JSON) with Editor access for this to work.
 */
export async function updateDocSection(
  fileId: string,
  _breadcrumb: string,
  originalExcerpt: string,
  correctedContent: string
): Promise<{ success: boolean; docId: string | null; error?: string }> {
  const docId = extractDocId(fileId);
  if (!docId) return { success: false, docId: null, error: 'Could not extract Doc ID from fileId URL' };

  // Trim to the first 200 chars of the excerpt for the replaceAllText match
  // (replaceAllText has a character limit and we want to match a unique string)
  const searchText = originalExcerpt.trim().slice(0, 200);
  if (!searchText) return { success: false, docId, error: 'Empty excerpt — cannot locate section' };

  try {
    const auth = getDocsAuth();
    const docs = google.docs({ version: 'v1', auth });

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            replaceAllText: {
              containsText: { text: searchText, matchCase: true },
              replaceText: correctedContent.trim(),
            },
          },
        ],
      },
    });

    // Force KB refresh so the next query uses the updated Doc
    await storeClearKBCache();

    return { success: true, docId };
  } catch (err: any) {
    const msg = err?.message || String(err);
    // If the service account doesn't have Editor access the error will say "403 The caller does not have permission"
    console.error('[gdocs] updateDocSection error:', msg);
    return { success: false, docId, error: msg };
  }
}

/** Returns the service account email from the JSON — useful for the setup UI hint. */
export function getServiceAccountEmail(): string {
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) return '';
    const creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
    return creds.client_email || '';
  } catch {
    return '';
  }
}
