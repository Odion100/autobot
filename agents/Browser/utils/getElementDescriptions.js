import Agentci from "agentci";
import ElementIdentifier from "../ElementIdentifier.js";
import getScreenshots from "./getScreenshots.js";
import driver from "./driver.js";
const agent = Agentci().rootAgent(ElementIdentifier);

export default async function getElementDescriptions({
  targetElements,
  fullScreenshot,
  args = {},
  type,
}) {
  if (!fullScreenshot) fullScreenshot = await driver.getScreenshot();
  console.log("fullScreenshot", fullScreenshot);
  const screenshots = await getScreenshots(targetElements);

  console.log("screenshots -->1111", screenshots);

  async function describeElements(containerImage, containerNumber) {
    const elementNumbers = targetElements
      .filter((item) => item.containerNumber === containerNumber)
      .map(({ elementNumber }) => elementNumber)
      .join(", ");

    const message = `Please identify the highlighted elements of the following number(s): ${elementNumbers}. If you do not see a highlighted element matching a given number, please skip it or provide elementNumber = 0 in your response.`;
    const identifiedContainer = await agent.invoke({
      message,
      images: [fullScreenshot, containerImage],
      ...args,
    });
    identifiedContainer.containerNumber = containerNumber;
    console.log("describeElement2", containerImage, identifiedContainer);
    return identifiedContainer;
  }
  const identifiedContainers = await Promise.all(
    screenshots.map(({ screenshot, containerNumber }) =>
      describeElements(screenshot, containerNumber)
    )
  );
  console.log("identifiedContainers", identifiedContainers);
  let fullMatch;

  const elementDescriptions = [];
  const fullMatchContainers = [];
  const partialMatchContainers = [];

  for (const identifiedContainer of identifiedContainers) {
    if (identifiedContainer.matchesCriteria === "full-match")
      fullMatchContainers.push({
        ...driver.getContainer(identifiedContainer.containerNumber),
        matchesCriteria: "full-match",
      });
    if (identifiedContainer.matchesCriteria === "partial-match")
      partialMatchContainers.push({
        ...driver.getContainer(identifiedContainer.containerNumber),
        matchesCriteria: "partial-match",
      });

    for (const identifier of identifiedContainer.identifiedElements) {
      const identifiedElement =
        targetElements.find(({ number }) => number === identifier.elementNumber) || {};

      if (identifiedElement) {
        identifier.selector = identifiedElement.selector;
        identifier.container = identifiedElement.container;
        identifier.type = identifiedElement.type;
        identifier.containerName = identifiedContainer.containerName;
        identifier.containerFunctionality = identifiedContainer.containerFunctionality;
        identifier.positionRefresh = identifiedContainer.positionRefresh;
        identifier.usage = 0;
        elementDescriptions.push(identifier);
        if (identifier.matchesCriteria === "full-match" && identifier.type === type)
          fullMatch = identifier;
      }
    }
  }
  return { elementDescriptions, fullMatchContainers, partialMatchContainers, fullMatch };
}
