import formidable from 'formidable';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import axios from 'axios';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import gTTS from 'gtts';

// Configure ffmpeg to use the static binary
ffmpeg.setFfmpegPath(ffmpegPath);

export const config = {
  api: {
    bodyParser: false,
  },
};

/*
 * API route to accept a video file and translation target.
 * This implementation performs the following steps:
 * 1. Extract the audio from the uploaded video using ffmpeg.
 * 2. Transcribe the audio using the Deepgram API.
 * 3. Translate the transcript using LibreTranslate.
 * 4. Generate synthesized speech in the target language using gtts.
 * 5. Replace the original audio with the synthesized audio in the video using ffmpeg.
 * 6. Return a base64\u202fencoded MP4 file to the client.
 *
 * Note: This process can be slow and resource intensive. It is intended for
 * short clips (a few seconds) and will fail on large files due to serverless
 * function limits. You must set the DEEPGRAM_API_KEY environment variable on
 * your deployment for transcription to work.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const form = formidable({ multiples: false });
  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(500).json({ error: 'Failed to parse form data' });
      return;
    }
    const targetLang = fields.targetLang || 'hi';
    const file = files.video;
    if (!file) {
      res.status(400).json({ error: 'No video file provided' });
      return;
    }
    // Determine source language based on target
    const sourceLang = targetLang === 'hi' ? 'en' : 'hi';
    // Temporary working directory
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidtrans-'));
    const videoPath = path.join(tmpDir, 'input');
    const audioPath = path.join(tmpDir, 'audio.wav');
    const ttsPath = path.join(tmpDir, 'tts.mp3');
    const outputPath = path.join(tmpDir, 'output.mp4');
    try {
      // Copy uploaded file to tmp directory
      await fs.copyFile(file.filepath, videoPath);
      // Extract audio to WAV
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .noVideo()
          .audioCodec('pcm_s16le')
          .format('wav')
          .save(audioPath)
          .on('end', resolve)
          .on('error', reject);
      });
      // Read audio file for transcription
      const audioData = await fs.readFile(audioPath);
      // Call Deepgram for transcription
      const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
      if (!deepgramApiKey) {
        throw new Error('Deepgram API key is not configured');
      }
      const transcriptResp = await axios.post(
        `https://api.deepgram.com/v1/listen?model=general&language=${sourceLang}`,
        audioData,
        {
          headers: {
            'Authorization': `Token ${deepgramApiKey}`,
            'Content-Type': 'audio/wav'
          }
        }
      );
      const transcript = transcriptResp.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      if (!transcript) {
        throw new Error('Failed to transcribe audio');
      }
      // Translate using LibreTranslate
      const translationResp = await axios.post('https://libretranslate.de/translate', {
        q: transcript,
        source: sourceLang,
        target: targetLang,
        format: 'text'
      }, { headers: { 'Content-Type': 'application/json' } });
      const translatedText = translationResp.data?.translatedText || '';
      if (!translatedText) {
        throw new Error('Failed to translate text');
      }
      // Generate TTS audio using gtts
      await new Promise((resolve, reject) => {
        const gtts = new gTTS(translatedText, targetLang);
        gtts.save(ttsPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      // Merge new audio with original video
      await new Promise((resolve, reject) => {
        ffmpeg()
          .addInput(videoPath)
          .addInput(ttsPath)
          .outputOptions([
            '-map 0:v:0', // take the video from first input
            '-map 1:a:0', // take audio from second input
            '-c:v copy',
            '-shortest'
          ])
          .save(outputPath)
          .on('end', resolve)
          .on('error', reject);
      });
      const outputBuffer = await fs.readFile(outputPath);
      // Encode to base64 data URL
      const base64 = outputBuffer.toString('base64');
      const dataUrl = `data:video/mp4;base64,${base64}`;
      // Cleanup temporary files
      await fs.rm(tmpDir, { recursive: true, force: true });
      res.status(200).json({ url: dataUrl });
    } catch (e) {
      console.error(e);
      // Attempt to clean up tmpDir
      try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch (_) {}
      res.status(500).json({ error: e.message || 'Processing failed' });
    }
  });
}
