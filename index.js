import driver from "./common/driver/index.js";
import WebAssistant from "./agents/WebAssistant/index.js";
import { deleteScreenshots } from "./common/utils/index.js";
import ElementIdentifier from "./modules/ElementIdentifier.js";
import Agentci from "agentci";
import { connectToMongoDB } from './db/connection.js';
import Job from './db/models/Job.js';

const state = { messages: [] };
driver.init({
  ElementIdentifier: Agentci().rootAgent(ElementIdentifier),
  WebAssistant,
});

driver.navigate("https://egate.smithdrug.com");

deleteScreenshots();

// MongoDB Connection
let db;
connectToMongoDB().then(database => {
  db = database;
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('Failed to connect to MongoDB', err);
});