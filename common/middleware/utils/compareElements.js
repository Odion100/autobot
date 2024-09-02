import driver from "../../driver/index.js";
import { multiParameterSearch } from "./multiParameterSearch.js";

export async function compareElements(
  targetElements,
  fullScreenshot,
  type,
  { args, agents: { ElementIdentifier } }
) {
  const { elementDescriptions, fullMatchContainers, partialMatchContainers, fullMatch } =
    await driver.getElementDescriptions({
      ElementIdentifier,
      targetElements,
      fullScreenshot,
      args,
      type,
    });
  args.searchedContainers = args.targetContainers;
  args.searchedElements = elementDescriptions.filter(
    ({ matchQuality }) => matchQuality === "no-match"
  );
  args.fullMatchContainers = fullMatchContainers.length ? fullMatchContainers : null;

  if (elementDescriptions.length) driver.cacheSelectors(elementDescriptions);

  if (fullMatch) return { results: [fullMatch], distances: [0.2] };
  if (!elementDescriptions.length) return { results: [], distances: [] };
  const filteredElements = elementDescriptions.filter(
    ({ matchQuality }) => matchQuality !== "no-match"
  );
  console.log("filteredElements xx-->>", filteredElements);
  if (!filteredElements.length) return { results: [], distances: [] };

  return await driver.compareIdentifiers(filteredElements, args, { type });
}
