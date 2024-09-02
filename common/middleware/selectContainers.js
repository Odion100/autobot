import driver from "../driver/index.js";
import { compareContainers } from "./utils/index.js";

export async function selectContainers(mwData, next) {
  const { args, agents, state } = mwData;
  if (args.selectedElement) return next();
  const { containerName } = args;
  if (containerName) {
    const identifiers = await driver.getSelectors({ containerName });
    const filteredIdentifiers = await driver.pageFilter(identifiers);
    if (filteredIdentifiers.length) {
      args.targetContainers = [
        await driver.addContainer(filteredIdentifiers[0].container),
      ];
    }
  }

  if (!args.targetContainers) {
    if (!args.containerText) {
      const { searchTerm } = await agents.RefineSearch.invoke(
        {
          message:
            "Please provide more containerText search terms for the target element based on the previous screenshot",
        },
        { messages: [...state.messages] }
      );
      if (searchTerm) Object.assign(args, searchTerm);
    }
    const filter = args.searchedContainers
      ? { selector: { $nin: args.searchedContainers.map(({ selector }) => selector) } }
      : undefined;
    const { results, distances } = await driver.findContainers(
      `${args.containerText}, ${args.innerText}`,
      filter
    );
    if (distances[0] <= 0.35) {
      args.targetContainers = results.filter(
        (item, index) => distances[index] <= distances[0] + 0.05
      );
      if (args.targetContainers.length > 1) {
        const containers = await compareContainers(args.targetContainers, mwData);
        if (containers.length) args.targetContainers = containers;
      }
    }
    if (!args.targetContainers) args.targetContainers = results;
  }
  if (args.targetContainers && args.targetContainers.length === 1)
    await driver.scrollIntoView(args.targetContainers[0].selector);

  next();
}
