export default async function handleSpeechOutput(text) {
    try {
      console.log('Text for synthesis:', text);
      const response = await fetch(`http://localhost:3000/api/text-to-speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorDetails = await response.json();
        throw new Error(`Failed to fetch synthesized audio. Server response: ${errorDetails.error}`);
      } 
      // Convert the binary response into a Blob
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      // Create and play the audio
      const audio = new Audio(audioUrl);
      audio.play();

      console.log('Audio playback started successfully.');

    } catch (error) {
      console.error('Error during text-to-speech:', error);
      alert('An error occurred while processing speech output.');
    }
  }