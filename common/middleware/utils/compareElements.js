import driver from "../../driver/index.js";

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
  driver.hideContainers();
  args.searchedContainers = args.targetContainers;
  args.searchedElements = elementDescriptions.filter(
    ({ matchQuality }) => matchQuality === "no-match"
  );
  args.fullMatchContainers = fullMatchContainers.length ? fullMatchContainers : null;
  console.log("compareElements args", args);
  if (elementDescriptions.length) driver.cacheSelectors(elementDescriptions);

  if (fullMatch) return { results: [fullMatch], distances: [0.2] };
  if (!elementDescriptions.length) return { results: [], distances: [] };
  const filteredIdentifiers = elementDescriptions.filter(
    ({ matchQuality }) => matchQuality !== "no-match"
  );
  console.log("filteredIdentifiers xx-->>", filteredIdentifiers);
  if (!filteredIdentifiers.length) return { results: [], distances: [] };

  return { results: filteredIdentifiers, distances: filteredIdentifiers.map(() => 0.36) };
  // return await driver.compareIdentifiers(
  //   filteredIdentifiers,
  //   `${args.elementName}: ${args.elementFunctionality}`,
  //   { type }
  // );
}
