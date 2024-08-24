import driver from "../../driver/index.js";

export async function getElementLocation(mwData, next) {
  const {
    state,
    agents: { ElementLocator, RefineSearch },
    args,
  } = mwData;
  console.log("getElementLocation-->", args.selectedElement);
  if (!args.selectedElement) {
    await driver.hideContainers();
    await driver.clearSelection();
    const { totalSections } = await driver.setupSections();
    console.log("totalSections2-->", totalSections);
    if (totalSections > 1) {
      const fullPage = await driver.getScreenshot(true);
      await driver.clearSections();
      const currentSection = await driver.getCurrentSection();
      console.log("invoking ElementLocation", fullPage, currentSection);
      const { sectionNumber, reasoning } = await ElementLocator.invoke({
        message: `We are currently in section ${currentSection} of the web page. Please locate the section of the element that matches the follow search criteria: 
            - Element Name: ${args.elementName}.
            - Element Functionality: ${args.elementFunctionality}`,
        image: fullPage,
        ...args,
      });
      await driver.showContainers();
      console.log("sectionNumber, reasoning", sectionNumber, reasoning);
      if (!sectionNumber) {
        args.searchHelpMessage = reasoning;
      } else if (Math.round(sectionNumber) === Math.round(currentSection)) {
        const { searchTerm, notFound } = await RefineSearch.invoke(
          {
            message:
              "Please provide search terms for the target element based on the previous screenshot",
          },
          { messages: [...state.messages] }
        );
        if (searchTerm) {
          Object.assign(args, searchTerm);
          return searchPage(mwData, next);
        } else {
          args.searchHelpMessage = `The ${args.elementName} should be seen in this current location of the web page. Please refine your search parameters to properly get a handle on the element.`;
          await driver.goToSection(sectionNumber);
        }
      } else {
        await driver.goToSection(sectionNumber);
        await driver.showContainers();
        const image = await driver.getScreenshot();
        const { searchTerm, notFound } = await RefineSearch.invoke(
          {
            image,
            message:
              "Please provide search terms for the target element based on the screenshot",
            ...args,
          },
          { messages: [...state.messages] }
        );
        if (searchTerm) {
          Object.assign(args, searchTerm);
          return searchPage(mwData, next);
        } else {
          args.searchHelpMessage = `We have scrolled to section ${sectionNumber}. The ${args.elementName} should be seen in this current location of the web page. Please refine your search parameters to properly get a handle on the element.`;
          await driver.goToSection(sectionNumber);
        }
      }
    }
  }
  next();
}
