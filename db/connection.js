import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { DB_CONNECTION } from '../common/constants.js';
console.log("DB_CONNECTION", DB_CONNECTION)
dotenv.config();

export function connectToMongoDB() {
  return mongoose.connect(DB_CONNECTION, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));
}

