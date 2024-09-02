import driver from "../driver/index.js";

export async function getDomainMemory({ state }, next) {
  state.domainMemory = await driver.getSelectors({ positionRefresh: "static" });
  console.log("getDomainMemory state.domainMemory", state.domainMemory);
  next();
}
