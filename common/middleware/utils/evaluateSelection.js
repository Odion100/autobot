import driver from "../../driver/index.js";

async function evaluateAnchoredSelector(identifier, mwData) {
  const potentialAnchors = await driver.filterPotentialAnchors(identifier);
  const potentialIdentifiers = [];
  for (const anchor of potentialAnchors) {
    const { containerNumber } = await driver.addContainer(anchor);
    potentialIdentifiers.push({
      ...identifier,
      container: anchor,
      selector: `${anchor} > ${identifier.subSelector}`,
      containerNumber,
    });
  }
  if (potentialIdentifiers.length === 1) return potentialIdentifiers[0];
  if (potentialIdentifiers.length > 1) {
    const fullScreenshot = await driver.getScreenshot();
    const {
      fn,
      args,
      agents: { ElementIdentifier },
    } = mwData;
    const { fullMatch } = await driver.getElementDescriptions({
      ElementIdentifier,
      targetElements: potentialIdentifiers,
      fullScreenshot,
      args,
      type: mwData.fn === "type" ? "typeable" : "clickable",
    });
    return fullMatch;
  }
}
export async function evaluateSelection(elementIdentifiers, distances, mwData) {
  await driver.hideContainers();
  const { args, agents } = mwData;
  const { VisualConfirmation } = agents;
  for (const i in elementIdentifiers) {
    const dist = distances[i];
    if (dist < 0.4) {
      const identifier = elementIdentifiers[i].anchors
        ? await evaluateAnchoredSelector(elementIdentifiers[i], mwData)
        : elementIdentifiers[i];
      if (identifier) {
        if (dist < 0.34) {
          const element = await driver.selectElement(identifier);
          if (element) {
            args.identifier = identifier;
            return element;
          }
        } else {
          const element = await driver.selectElement(identifier);
          if (element) {
            const image = identifier.container
              ? await driver.captureElement(identifier.container)
              : await driver.getScreenshot();
            const isMatch = await VisualConfirmation.invoke({
              message: `Is the correct element selected (surrounded by a green box) in the screenshot?`,
              image,
              ...args,
            });
            if (isMatch) {
              args.identifier = identifier;
              return element;
            }
          }
        }
      }
    }
  }
}
