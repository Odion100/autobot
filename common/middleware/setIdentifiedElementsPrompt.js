import driver from "../driver/index.js";
import { removeDuplicates } from "../utils/index.js";

export async function setIdentifiedElementsPrompt({ state }, next) {
  console.log(state.identifiedElements, "<---- here");
  if (state.identifiedElements) {
    const savedIdentifiers = await driver.pageFilter(state.identifiedElements);
    const filteredIdentifiers = removeDuplicates(savedIdentifiers, "selector");
    console.log(filteredIdentifiers, "<---- here2");

    if (filteredIdentifiers.length) {
      const containers = filteredIdentifiers.reduce(
        (acc, { containerName, containerFunctionality }) => {
          if (!acc.some((item) => item.containerName === containerName)) {
            acc.push({ containerName, containerFunctionality });
          }
          return acc;
        },
        []
      );
      console.log(containers, "<---- here3");

      let xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n<identified-elements>\n';
      xmlContent +=
        "  <description>Following is a list of parameters for containers and elements you've previously identified on this page.</description>\n";
      for (const [index, container] of containers.entries()) {
        const { containerName, containerFunctionality } = container;
        xmlContent += `  <container id="${index + 1}">\n`;
        xmlContent += `    <containerName>${escapeXml(containerName)}</containerName>\n`;
        xmlContent += `    <containerFunctionality>${escapeXml(
          containerFunctionality
        )}</containerFunctionality>\n`;
        xmlContent += "    <elements>\n";
        for (const identifier of filteredIdentifiers) {
          if (identifier.containerName === containerName) {
            const { elementName, elementFunctionality, id } = identifier;
            xmlContent += "      <element>\n";
            xmlContent += `        <elementName>${escapeXml(
              elementName
            )}</elementName>\n`;
            xmlContent += `        <elementFunctionality>${escapeXml(
              elementFunctionality
            )}</elementFunctionality>\n`;
            xmlContent += `        <identifiedElementId>${escapeXml(
              id
            )}</identifiedElementId>\n`;
            xmlContent += "      </element>\n";
          }
        }
        xmlContent += "    </elements>\n";
        xmlContent += "  </container>\n";
      }
      xmlContent += "  <instructions>\n";
      xmlContent +=
        "    <instruction>Use these saved identifiers to help select elements from memory when applicable to your current task.</instruction>\n";
      xmlContent +=
        "    <instruction>IMPORTANT: Remember to use the identifiedElementId when calling type and click functions using Identified Elements.</instruction>\n";
      xmlContent += "  </instructions>\n";
      xmlContent += "</identified-elements>";
      state.identifiedElementsPrompt = xmlContent;
      console.log(state.identifiedElementsPrompt, "<---- here4");

      return next();
    }
  }

  state.identifiedElementsPrompt =
    "<identified-elements>No items on this page</identified-elements>";
  console.log(state.identifiedElementsPrompt, "<---- here5");

  next();
}
function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
    }
  });
}
