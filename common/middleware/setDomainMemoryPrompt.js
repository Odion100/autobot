import driver from "../driver/index.js";
import { removeDuplicates } from "../utils/index.js";

export async function setDomainMemoryPrompt({ state }, next) {
  if (!state.domainMemory) return "";
  const savedIdentifiers = await driver.pageFilter(state.domainMemory);
  const filteredIdentifiers = removeDuplicates(savedIdentifiers, "selector");
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
    let xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n<domain-memory>\n';
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
          xmlContent += `        <elementName>${escapeXml(elementName)}</elementName>\n`;
          xmlContent += `        <elementFunctionality>${escapeXml(
            elementFunctionality
          )}</elementFunctionality>\n`;
          xmlContent += `        <domainMemoryId>${escapeXml(id)}</domainMemoryId>\n`;
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
      "    <instruction>IMPORTANT: Remember to use the domainMemoryId when calling type and click functions using domain memory.</instruction>\n";
    xmlContent += "  </instructions>\n";
    xmlContent += "</domain-memory>";
    state.domainMemoryPrompt = xmlContent;

    return next();
  }
  state.domainMemoryPrompt = "<domain-memory>No items on this page</domain-memory>";
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
