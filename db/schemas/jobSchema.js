import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  instructions: {
    type: String,
    required: true
  },
  milestones: {
    type: [String],
    required: true
  }
}, { timestamps: true });

export default jobSchema;