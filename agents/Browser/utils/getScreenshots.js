import driver from "./driver.js";

export default async function getScreenshots(identifiedElements, containerOnly) {
  const uniqueContainers = [];
  console.log("identifiedElements sccr", identifiedElements);
  const screenshots = [];
  for (const { containerNumber } of identifiedElements) {
    console.log("containerNumber 467", containerNumber);
    if (!uniqueContainers.includes(containerNumber)) {
      uniqueContainers.push(containerNumber);
      await driver.hideContainers();
      await driver.showContainers(containerNumber);
      screenshots.push({
        containerNumber,
        screenshot: await driver.captureContainer(containerNumber, containerOnly),
      });
    }
  }
  //await driver.hideContainers();
  return screenshots;
}
