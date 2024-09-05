# autobot
1. copy example.env, rename to .env, fill in the values
2. install node packages

```
  npm install

```
3. install chromadb
  `pip install chromadb`

4. Start chromadb
   `chroma run --path ./vectorStore`

5. Start app
  `node index`


When you need to use the Job model in your existing functions:
```
  import Job from './db/models/Job.js';

  async function someExistingFunction() {
    // Existing code

    const newJob = new Job({
      title: 'Example Job',
      instructions: 'Do this and that',
      milestones: ['Step 1', 'Step 2', 'Step 3']
    });
    await newJob.save();

    // More existing code
  }
```

Example Job:
```
  import { createJob } from './db/operations/jobOperations.js';
  import WebAssistant from "./agents/WebAssistant/index.js";
  import driver from "./common/driver/index.js";

  async function performLoginJob() {
    const job = await createJob(
      'Login to egate.smithdrug.com',
      'Navigate to the login page and perform login operation',
      [
        'Navigate to https://egate.smithdrug.com',
        'Locate login form',
        'Enter credentials',
        'Submit login form',
        'Verify successful login'
      ]
    );

    await driver.navigate("https://egate.smithdrug.com");
    
    const webAssistant = new WebAssistant(driver);
    await webAssistant.performLogin();

    // Update job status or add results here

    return job;
  }
```