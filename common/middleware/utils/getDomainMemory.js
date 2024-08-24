import driver from "../../driver/index.js";

export async function getDomainMemory({ state }) {
  state.domainMemory = await driver.getSelectors({ positionRefresh: "static" });
  console.log("state.domainMemory", state.domainMemory);
}
