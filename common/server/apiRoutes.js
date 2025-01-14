import express from 'express';
import OpenAI from 'openai';
import multer from 'multer';
import fs from 'fs';
import path from 'path'; 
import { promisify } from 'util';


const router = express.Router();
const upload = multer();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const writeFile = promisify(fs.writeFile);

// Speech-to-Text API
router.post('/speech-to-text', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      console.error('No file uploaded.');
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    console.log('File uploaded:', {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    // Save file temporarily
    const outputAudioPath = path.join('C:/autobot/common/server/static/', req.file.originalname);
    await writeFile(outputAudioPath, req.file.buffer);

    // Send the file to OpenAI's Speech-to-Text API
    const audio_file = fs.createReadStream(outputAudioPath);
    console.log('fs.createReadStream:', typeof fs.createReadStream);

    const response = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: audio_file,
    });
    console.log('Raw STT response:', response);

    // Check if response contains text
    if (response && response.text) {
      console.log('Response Text:', response.text);
      res.json({ text: response.text });
    } else {
      console.error('No transcription received.');
      res.status(500).json({ error: 'No transcription received.' });
    }
  } catch (error) {
    console.error('Speech-to-Text Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to transcribe speech.' });
  }
});


async function streamToFile(stream, path) {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(path)
      .on('error', reject)
      .on('finish', resolve);

    stream.pipe(writeStream)
      .on('error', (error) => {
        writeStream.close();
        reject(error);
      });
  });
}

router.post('/text-to-speech', async (req, res) => {
  const { text } = req.body;
  console.log('Router received text:', text)
  if (!text) {
    return res.status(400).json({ error: 'Missing required field: text' });
  }

  try {
    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'alloy', // Specify desired voice (alloy, ash, coral, echo, fable, onyx, nova, sage and shimmer)
      input: text,
    });

    const stream = response.body;
    const outputAudioPath = 'C:/autobot/common/server/static/speech.mp3';
    await streamToFile(stream, outputAudioPath);

    // Read and return the audio file as binary
    const audioData = fs.readFileSync(outputAudioPath);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline; filename="speech.mp3"',
    });
    res.send(audioData);

  } catch (error) {
    console.error('Error in text-to-speech conversion:', error);
    res.status(500).json({ error: 'Text-to-speech conversion failed', details: error.message });
  }
});

export default router;
