import mongoose from 'mongoose';
import jobSchema from '../schemas/jobSchema.js';

const Job = mongoose.model('Job', jobSchema);

export default Job;
