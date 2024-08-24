import driver from "../../driver/index.js";
import { multiParameterSearch } from "./multiParameterSearch.js";

export async function compareElements(
  targetElements,
  fullScreenshot,
  type,
  { args, agents }
) {
  const { elementDescriptions, fullMatchContainers, partialMatchContainers, fullMatch } =
    await driver.getElementDescriptions({ targetElements, fullScreenshot, args, type });
  args.searchedContainers = args.targetContainers;
  args.searchedElements = elementDescriptions.filter(
    ({ matchesCriteria }) => matchesCriteria === "no-match"
  );
  args.fullMatchContainers = fullMatchContainers.length ? fullMatchContainers : null;

  driver.cacheSelectors(elementDescriptions);

  if (fullMatch) return { results: [fullMatch], distances: [0.2] };
  if (!elementDescriptions.length) return { results: [], distances: [] };
  const filteredElements = elementDescriptions.filter(
    ({ matchesCriteria }) => matchesCriteria !== "no-match"
  );
  console.log("filteredElements xx-->>", filteredElements);
  if (!filteredElements.length) return { results: [], distances: [] };

  return await multiParameterSearch(filteredElements, args, { type });
}
