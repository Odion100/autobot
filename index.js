import driver from "./common/driver/index.js";
import WebAssistant from "./agents/WebAssistant/index.js";
import { deleteScreenshots } from "./common/utils/index.js";
import ElementIdentifier from "./modules/ElementIdentifier.js";
import Agentci from "agentci";
import { connectToMongoDB } from './db/connection.js';
import express from "express";
import apiRoutes from "./common/server/apiRoutes.js";
import cors from 'cors';

driver.init({
  ElementIdentifier: Agentci().rootAgent(ElementIdentifier),
  WebAssistant,
});

driver.navigate("https://www.google.com");

deleteScreenshots();

// MongoDB Connection
let db;
connectToMongoDB().then(database => {
  db = database;
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('Failed to connect to MongoDB', err);
});

// Set up Express server for API routes
const app = express();
app.use(express.json());
app.use('/static', express.static('C:/autobot/common/server/static'));

// Dynamic CORS Configuration
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || origin.startsWith('http://localhost') || /^https:\/\/.*/.test(origin)) {
            callback(null, true);
        } else {
          console.error(`CORS issue: Origin ${origin} not allowed`);
          callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
}));

// Debugging middleware
app.use((req, res, next) => {
  console.log(`Request Origin: ${req.headers.origin}`);
  console.log(`Request Method: ${req.method}`);
  next();
});

// Handle preflight requests
app.options('*', cors());
// Mount API Routes
app.use('/api', apiRoutes);

const EXPRESS_PORT = 3000;
app.listen(EXPRESS_PORT, () => {
  console.log(`Express server running on http://localhost:${EXPRESS_PORT}`);
});