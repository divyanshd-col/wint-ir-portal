import { randomUUID } from 'crypto';
import type { Pass1Result, StructureEvent, SpeakerLabel } from './call-analyzer';

export interface PyannoteSegment {
  start: number;
  end: number;
  speaker: string;
}

/**
 * Gets a pre-signed temporary upload URL from Pyannote API.
 */
export async function getPyannoteUploadUrl(apiKey: string): Promise<{ pyannoteUri: string; uploadUrl: string }> {
  const objectKey = randomUUID();
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

/**
 * Sends a diarization job request to Pyannote and polls status until it completes.
 */
export async function diarizeAudioWithPyannote(
  audioUrl: string,
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<PyannoteSegment[]> {
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

/**
 * Converts Pyannote diarization segments to the generic Pass1Result format.
 */
export function pyannoteToPass1(pyannoteSegments: PyannoteSegment[]): Pass1Result {
  const segments = Array.isArray(pyannoteSegments) ? pyannoteSegments : [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const events: StructureEvent[] = [];
  const speakerMap: Record<string, SpeakerLabel> = {};
  let nextLabelCode = 65; // 'A'

  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    if (!speakerMap[seg.speaker]) {
      if (nextLabelCode === 65) {
        speakerMap[seg.speaker] = 'A';
        nextLabelCode = 66;
      } else {
        speakerMap[seg.speaker] = 'B';
      }
    }
    const currentSpeaker = speakerMap[seg.speaker];

    // Check for silence (gap >= 2.0s) with previous segment
    if (i > 0) {
      const prev = sorted[i - 1];
      const gap = seg.start - prev.end;
      if (gap >= 2.0) {
        events.push({
          type: 'silence',
          start: prev.end,
          end: seg.start,
          duration: gap
        });
      }
      
      // Check for overlap
      if (seg.start < prev.end) {
        const prevSpeaker = speakerMap[prev.speaker];
        events.push({
          type: 'overlap',
          start: seg.start,
          end: Math.min(seg.end, prev.end),
          speaker_continuing: prevSpeaker,
          speaker_interrupting: currentSpeaker
        });
      }
    }

    events.push({
      type: 'turn',
      speaker: currentSpeaker,
      start: seg.start,
      end: seg.end
    });
  }

  events.sort((a, b) => a.start - b.start);

  const duration_seconds = sorted.length > 0 ? sorted[sorted.length - 1].end : 0;

  return {
    duration_seconds,
    events
  };
}
