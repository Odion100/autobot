import driver from "../driver/index.js";
import { compareElements, evaluateSelection } from "./utils/index.js";

export async function searchPage(mwData, next, secondSearch) {
  const { args, state, fn } = mwData;
  const { innerText, elementName } = args;
  const type = fn === "type" ? "typeable" : "clickable";
  if (state.navigationStarted) return next();
  if (args.selectedElement) return next();
  let filter;
  if (args.searchedElements && args.searchedElements.length) {
    filter = {
      $and: [
        {
          selector: {
            $nin: args.searchedElements
              // .filter(({ selector }) => typeof selector === "string")
              .map(({ selector }) => selector.toString()),
          },
        },
        { type },
      ],
    };
  } else if (secondSearch) {
    if (!filter) filter = { type };
  }

  const identifiedElements = await driver.searchPage(
    `${elementName}, ${innerText}`,
    args.targetContainers,
    filter,
    type
  );
  if (identifiedElements.length) {
    await driver.hideContainers();
    const fullScreenshot = await driver.getScreenshot();
    const { results, distances } = await compareElements(
      identifiedElements,
      fullScreenshot,
      type,
      mwData
    );
    await driver.hideContainers();
    console.log("results, distances", results, distances);
    if (results.length) {
      const selectedElement = await evaluateSelection(results, distances, mwData);
      console.log("selectedElement-->", selectedElement);
      if (selectedElement) {
        args.selectedElement = selectedElement;
        return next();
      }
    }
  }
  console.log("args.targetContainers", args.targetContainers, secondSearch);

  if (!secondSearch) {
    args.targetContainers = args.fullMatchContainers;
    return searchPage(mwData, next, true);
  }
  next();
}
