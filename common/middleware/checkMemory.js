import driver from "../driver/index.js";
import { multiParameterSearch, evaluateSelection } from "./utils/index.js";

async function searchMemory(
  { args, agents: { CompareDescriptions } },
  type,
  memoryDomain = "long-term"
) {
  const cache = memoryDomain === "cache";
  let searchResults;
  if (cache) {
    const filter = { type };
    searchResults = await driver.searchCache(
      `${args.elementName}: ${args.elementFunctionality}`,
      filter
    );
  } else {
    const filter = { $and: [{ type }, { positionRefresh: "dynamic" }] };
    searchResults = await driver.searchSelectors(
      `${args.elementName}: ${args.elementFunctionality}`,
      filter
    );
  }
  const { results, distances } = searchResults;
  if (distances[0] <= 0.35) {
    const savedIdentifiers = results.filter(
      (item, index) => distances[index] <= distances[0] + 0.05
    );
    const filteredIdentifiers = await driver.pageFilter(savedIdentifiers);
    if (filteredIdentifiers.length) {
      const { matchQuality, ...rest } = await CompareDescriptions.invoke({
        message:
          "Please identify if any of the element descriptions match the target element",
        targetElement: args,
        elementDescriptions: filteredIdentifiers,
      });
      if (matchQuality === "full-match") {
        return { results: [rest], distances: [0.2] };
      } else if (matchQuality === "partial-match") {
        return { results: [rest], distances: [0.36] };
      }
    }
  }

  return { results: [], distances: [] };
}
export async function checkMemory(mwData, next) {
  const { args, fn } = mwData;
  if (args.identifiedElementId) {
    const identifiers = await driver.getSelectors({ id: args.identifiedElementId });
    console.log("memory id", args.identifiedElementId, identifiers);
    if (identifiers.length) {
      const selectedElement = await evaluateSelection(identifiers, [0.2], mwData);
      if (selectedElement) {
        args.selectedElement = selectedElement;
        return next();
      }
    }
  }
  const type = fn === "type" ? "typeable" : "clickable";

  if (!args.selectedElement) {
    const { results, distances } = await searchMemory(mwData, type, "long-term");
    if (results.length) {
      const selectedElement = await evaluateSelection(results, distances, mwData);
      if (selectedElement) {
        args.selectedElement = selectedElement;
        return next();
      }
    }
  }
  if (!args.selectedElement) {
    const { results, distances } = await searchMemory(mwData, type, "cache");
    if (results.length) {
      const selectedElement = await evaluateSelection(results, distances, mwData);
      if (selectedElement) {
        args.selectedElement = selectedElement;
        return next();
      }
    }
  }

  next();
}
