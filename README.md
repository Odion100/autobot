# autobot

```javascript
async function processImageRequest(filePath) {
  const imageBuffer = await fs.readFile(filePath);
  const base64Image = imageBuffer.toString("base64");
  const encodedImage = `data:image/jpeg;base64,{${base64Image}}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4-vision-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: tablePrompt },
          { type: "image_url", image_url: { url: encodedImage } },
        ],
      },
    ],
    max_tokens: 1024,
  });
  return response;
}
```
