/**
 * Groq Whisper Transcription & Vision Service
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY || 'AJOUTEZ_VOTRE_CLE_API_ICI';
const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

/**
 * Transcribe an audio file using Groq Whisper.
 */
export async function transcribeAudio(audioUri: string): Promise<string> {
  const formData = new FormData();
  const fileName = `recording-${Date.now()}.m4a`;
  formData.append('file', {
    uri: audioUri,
    type: 'audio/m4a',
    name: fileName,
  } as any);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'fr');
  formData.append('response_format', 'json');

  const response = await fetch(GROQ_WHISPER_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`Groq transcription failed (${response.status}): ${errorBody}`);
  }

  const result: TranscriptionResult = await response.json();
  if (!result.text || result.text.trim().length === 0) {
    throw new Error('Transcription returned empty text. Please try speaking louder or longer.');
  }
  return result.text.trim();
}

/**
 * Convert a local image URI to a base64 data URL.
 */
export async function imageToBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Analyze an image using Groq vision model (llama-4-scout).
 */
export async function analyzeImage(
  imageUri: string,
  userPrompt: string = 'Décris cette image en détail.'
): Promise<string> {
  const base64 = await imageToBase64(imageUri);

  const body = {
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: base64 } },
        ],
      },
    ],
    max_tokens: 2048,
  };

  const response = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`Groq vision failed (${response.status}): ${errorBody}`);
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content || 'No analysis available.';
}

