import Job from '../models/Job.js';

export const createJob = async (title, instructions, milestones) => {
  const newJob = new Job({ title, instructions, milestones });
  return await newJob.save();
};

export const getJob = async (jobId) => {
  return await Job.findById(jobId);
};

export const updateJob = async (jobId, title, instructions, milestones) => {
  return await Job.findByIdAndUpdate(jobId, { title, instructions, milestones }, { new: true });
};

export const deleteJob = async (jobId) => {
  return await Job.findByIdAndDelete(jobId);
};
