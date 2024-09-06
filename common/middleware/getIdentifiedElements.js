import driver from "../driver/index.js";

export async function getIdentifiedElements({ state }, next) {
  state.identifiedElements = await driver.getSelectors({ positionRefresh: "static" });
  console.log("getIdentifiedElements state.identifiedElements", state.identifiedElements);
  next();
}
