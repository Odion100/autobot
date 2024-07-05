const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({ headless: false }); // Set headless to false to see the browser
  const page = await browser.newPage();
  await page.goto("https://example.com"); // Replace with your target URL

  const targetSelectors = ["#target1", ".target2", "div.someClass"]; // Replace with your target selectors

  // Expose a function to take a screenshot
  await page.exposeFunction("takeScreenshot", async (action, selector, timestamp) => {
    const fileName = `screenshot-${action}-${selector.replace(
      /[^a-zA-Z0-9-_]/g,
      "_"
    )}-${timestamp}.png`;
    await page.screenshot({ path: fileName });
    console.log(`Screenshot taken: ${fileName}`);
  });

  // Expose a function to start recording actions
  await page.exposeFunction("startRecording", (selectors) => {
    const actions = [];

    const logAction = async (action, element, event) => {
      event.stopPropagation(); // Stop the event from propagating further
      const timeStamp = new Date().toISOString();
      const selector = element.getAttribute("data-selector");
      actions.push({ action, selector, timeStamp });
      console.log({ action, selector, timeStamp });

      // Call the exposed function to take a screenshot
      await window.takeScreenshot(action, selector, timeStamp);
    };

    window.stopRecording = () => {
      selectors.forEach((selector) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach((element) => {
          element.removeEventListener("click", element.clickListener);
        });
      });
      console.log("Recording stopped");
    };

    selectors.forEach((selector) => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((element) => {
        element.setAttribute("data-selector", selector); // Add a unique identifier for each element

        element.clickListener = (event) => logAction("click", event.target, event);
        element.addEventListener("click", element.clickListener);
      });
    });

    window.getRecordedActions = () => actions;
    console.log("Recording started");
  });

  // Start recording
  await page.evaluate((selectors) => {
    window.startRecording(selectors);
  }, targetSelectors);

  // Wait for user interactions
  console.log("Please interact with the page...");
  await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait for 30 seconds for user interactions

  // Stop recording
  await page.evaluate(() => {
    window.stopRecording();
  });

  // Retrieve the recorded actions
  const recordedActions = await page.evaluate(() => window.getRecordedActions());
  console.log("Recorded Actions:", recordedActions);

  await browser.close();
})();
