import readline from "readline";
import driver from "./common/driver/index.js";
import WebTaskExecutor from "./agencies/WebTaskExecutor/index.js";
import deleteScreenshots from "./common/utils/deleteScreenshots.js";
const state = { messages: [] };
driver.navigate("https://egate.smithdrug.com");

deleteScreenshots();
