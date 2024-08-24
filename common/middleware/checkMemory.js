import driver from "../driver/index.js";
import { multiParameterSearch, evaluateSelection } from "./utils/index.js";

async function searchMemory(searchParams, filter, memoryDomain = "long-term") {
  const cache = memoryDomain === "cache";
  let searchResults;
  if (cache) {
    searchResults = await driver.searchCache(
      `${searchParams.elementName}: ${searchParams.elementFunctionality}`,
      filter
    );
  } else {
    searchResults = await driver.searchSelectors(
      `${searchParams.elementName}: ${searchParams.elementFunctionality}`,
      filter
    );
  }
  const { results, distances } = searchResults;

  const savedIdentifiers = results.filter((data, i) => distances[i] <= 0.45);
  const dist = distances.filter((value) => value <= 0.45);
  console.log(`savedIdentifiers, distances ${memoryDomain}`, savedIdentifiers, dist);
  if (savedIdentifiers.length) {
    const filteredIdentifiers = await driver.pageFilter(savedIdentifiers);
    if (filteredIdentifiers.length) {
      return await multiParameterSearch(filteredIdentifiers, searchParams);
    }
  }

  return { results: [], distances: [] };
}
export async function checkMemory(mwData, next) {
  const { args, fn } = mwData;
  if (args.domainMemoryId) {
    const identifiers = await driver.getSelectors({ id: args.domainMemoryId });
    console.log("memory id", args.domainMemoryId, identifiers);
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
    const filter = { $and: [{ type }, { positionRefresh: "dynamic" }] };
    const { results, distances } = await searchMemory(args, filter, "long-term");
    if (results.length) {
      const selectedElement = await evaluateSelection(results, distances, mwData);
      if (selectedElement) {
        args.selectedElement = selectedElement;
        return next();
      }
    }
  }
  if (!args.selectedElement) {
    const filter = { type };
    const { results, distances } = await searchMemory(args, filter, "cache");
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
