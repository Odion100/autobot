import driver from "../../common/driver/index.js";

export async function resetContainers({}, next) {
  await driver.clearSelection();
  await driver.clearContainers();
  await driver.setContainers();
  next();
}
export async function clearContainer({}, next) {
  await driver.clearSelection();
  await driver.clearContainers();
  next();
}
export async function setPageLoadEvent({ state }, next) {
  const page = driver.page();
  state.currentSection = 0;
  state.totalSections = 0;
  state.currentUrl = page.url();
  state.pageLoadStart = (request) => {
    //console.log("state.navigationStarted, pageLoadStart", state.navigationStarted);
    if (
      !state.navigationStarted &&
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame() &&
      request.url() !== "about:blank"
    ) {
      state.navigationStarted = true;
      state.previousUrl = state.currentUrl;
      state.currentUrl = request.url();

      console.log(`Page is starting to load: ${request.url()}`);
    }
  };
  state.pageLoadEnd = async () => {
    console.log("Page has finished loading");
    state.navigationStarted = false;
  };
  page.on("request", state.pageLoadStart);
  page.on("load", state.pageLoadEnd);
  next();
}
export function clearPageLoadEvent({ state }, next) {
  const page = driver.page();
  page.on("load", state.pageLoadEnd);
  page.off("request", state.pageLoadStart);
  next();
}
