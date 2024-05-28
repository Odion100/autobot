import fs from "fs";
import path from "path";

// Function to delete and recreate a folder
async function deleteAndRecreateFolder(folderName) {
  const folderPath = path.join(process.cwd(), folderName);
  // console.log(fs.rmSync, typeof fs.readSync);
  try {
    fs.rmSync(folderPath, { recursive: true, force: true });
    // console.log(`Deleted folder: ${folderPath}`);

    fs.mkdirSync(folderPath, { recursive: true });
    // console.log(`Recreated folder: ${folderPath}`);
  } catch (err) {
    console.error(`Error: ${err}`);
  }
}

export default function deleteScreenshots() {
  // Replace 'your-folder-name-here' with the actual folder name within the CWD
  const folderName = "screenshots";
  deleteAndRecreateFolder(folderName);
}
