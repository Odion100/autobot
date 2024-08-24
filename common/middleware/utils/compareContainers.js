import driver from "../../driver/index.js";

export async function compareContainers(containers, { args, agents }) {
  const { ContainerIdentifier } = agents;
  await driver.hideContainers();
  await driver.addLabels(containers);
  const image = await driver.getScreenshot();
  const containerNumbers = containers
    .map(({ containerNumber }) => containerNumber)
    .join(", ");

  const message = `Please identify the highlighted containers of the following number(s): ${containerNumbers}.`;
  const results = await ContainerIdentifier.invoke({ message, image, ...args });
  const identifiedContainers = [];
  for (const item of results) {
    const identifiedContainer = containers.find(
      ({ containerNumber }) => containerNumber === item.containerNumber
    );
    if (identifiedContainer)
      identifiedContainers.push({
        ...item,
        ...identifiedContainer,
      });
  }
  driver.clearLabels();
  const fullMatch = identifiedContainers.filter(
    ({ matchesCriteria }) => matchesCriteria === "full-match"
  );
  console.log("compare containers identifiedContainers", identifiedContainers);
  console.log("compare containers fullMatch", fullMatch);
  return fullMatch.length
    ? fullMatch
    : identifiedContainers.filter(
        ({ matchesCriteria }) => matchesCriteria !== "no-match"
      );
}
