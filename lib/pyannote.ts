import { logLlmTokenUsage } from './token-tracker';

export interface PyannoteSegment {
  start: number;
  end: number;
  speaker: string;
}

import type { Pass1Result, StructureEvent } from './call-analyzer';
export type { Pass1Result, StructureEvent };

/**
 * Gets a pre-signed temporary upload URL from Pyannote API.
 */
export async function getPyannoteUploadUrl(apiKey: string): Promise<{ pyannoteUri: string; uploadUrl: string }> {
  const objectKey = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const pyannoteUri = `media://${objectKey}`;
  const res = await fetch('https://api.pyannote.ai/v1/media/input', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: pyannoteUri }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pyannote media input initiation failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return { pyannoteUri, uploadUrl: data.url };
}

export interface DiarizeOptions {
  entityId?: string;
  userEmail?: string;
}

/**
 * Sends a diarization job request to Pyannote and polls status until it completes.
 */
export async function diarizeAudioWithPyannote(
  audioUrl: string,
  apiKey: string,
  onProgress?: (msg: string) => void,
  opts?: DiarizeOptions
): Promise<PyannoteSegment[]> {
  const t0 = Date.now();
  onProgress?.('Initiating Pyannote diarization job…');
  const initRes = await fetch('https://api.pyannote.ai/v1/diarize', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: audioUrl,
      model: 'precision-2',
    }),
  });
  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`Pyannote diarization trigger failed (${initRes.status}): ${text}`);
  }
  const initData = await initRes.json();
  const jobId = initData.jobId;
  if (!jobId) {
    throw new Error(`No jobId returned from Pyannote. Response: ${JSON.stringify(initData)}`);
  }
  
  onProgress?.(`Pyannote job ${jobId} created — polling status…`);
  const maxAttempts = 150; // 5 minutes max
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await fetch(`https://api.pyannote.ai/v1/jobs/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    if (!statusRes.ok) {
      const text = await statusRes.text();
      throw new Error(`Failed to check Pyannote job status (${statusRes.status}): ${text}`);
    }
    const statusData = await statusRes.json();
    const status = statusData.status;
    
    if (status === 'succeeded') {
      onProgress?.('Pyannote diarization job completed successfully.');
      const output = (statusData.output || []) as PyannoteSegment[];
      console.log(`[Pyannote Output] Job ${jobId}:`, JSON.stringify(output, null, 2));

      // Calculate audio duration in seconds from max segment end
      const duration = output.length ? Math.max(...output.map(s => s.end || 0)) : 0;
      const latencyMs = Date.now() - t0;

      // Log token/duration usage to llm_token_logs for bifurcation analytics
      logLlmTokenUsage({
        jobType: 'call_diarization_pass1',
        featureGroup: 'Calls',
        modelName: 'pyannote-precision-2',
        inputTokens: 0,
        outputTokens: 0,
        durationSeconds: duration,
        latencyMs,
        entityId: opts?.entityId,
        userEmail: opts?.userEmail,
      }).catch(() => {});

      // Record token & cost tracking for Pyannote (main token tracker)
      try {
        const maxEnd = output.reduce((m, s) => Math.max(m, s.end), 0);
        const audioSeconds = Math.round(maxEnd) || 120;
        const inputTokens = audioSeconds * 30; // audio token equivalent (~30 tokens/sec)
        const outputTokens = output.length * 4;
        const { recordTokenUsage } = await import('@/lib/tokens/tracker');
        recordTokenUsage({
          provider: 'pyannote',
          model: 'pyannote-precision-2',
          feature: 'call_analysis',
          inputTokens,
          outputTokens,
          latencyMs: attempt * 2000,
          metadata: { jobId, audioSeconds, segments: output.length },
        });
      } catch {}

      return output;
    } else if (status === 'failed') {
      throw new Error(`Pyannote job failed: ${statusData.error ?? 'Unknown error'}`);
    } else if (status === 'canceled') {
      throw new Error('Pyannote job was canceled');
    }
    
    onProgress?.(`Pyannote job status: ${status} (attempt ${attempt}/${maxAttempts})…`);
  }
  throw new Error('Pyannote diarization job timed out after 5 minutes');
}

type SpeakerLabel = 'A' | 'B';

/**
 * Converts Pyannote diarization segments to the generic Pass1Result format.
 */
export function pyannoteToPass1(pyannoteSegments: any): Pass1Result {
  const segments = Array.isArray(pyannoteSegments)
    ? pyannoteSegments
    : (Array.isArray(pyannoteSegments?.diarization) ? pyannoteSegments.diarization : []);
  const sorted = [...segments].sort((a: any, b: any) => a.start - b.start);
  const events: StructureEvent[] = [];
  const speakerMap: Record<string, SpeakerLabel> = {};
  let nextLabelCode = 65; // 'A'

  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    if (!speakerMap[seg.speaker]) {
      if (nextLabelCode === 65) {
        speakerMap[seg.speaker] = 'A';
        nextLabelCode++;
      } else if (nextLabelCode === 66) {
        speakerMap[seg.speaker] = 'B';
        nextLabelCode++;
      } else {
        speakerMap[seg.speaker] = 'B';
      }
    }
  }

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const speaker = speakerMap[current.speaker] ?? 'A';
    if (i > 0) {
      const prev = sorted[i - 1];
      if (current.start < prev.end) {
        events.push({
          type: 'overlap',
          start: current.start,
          end: Math.min(prev.end, current.end),
          speaker_continuing: speakerMap[prev.speaker] ?? 'A',
          speaker_interrupting: speaker,
        });
      } else if (current.start > prev.end + 0.5) {
        events.push({
          type: 'silence',
          start: prev.end,
          end: current.start,
          duration: current.start - prev.end,
        });
      }
    }
    events.push({
      type: 'turn',
      speaker,
      start: current.start,
      end: current.end,
    });
  }

  const duration_seconds = sorted.length > 0 ? sorted[sorted.length - 1].end : 0;
  return { duration_seconds, events };
}
