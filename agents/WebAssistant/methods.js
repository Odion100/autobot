import Job from '../../db/models/Job.js';

export const createJob = async (jobData) => {
  console.log('Job Data:', jobData);
  const newJob = new Job(jobData);
  console.log('New Job:', newJob);
  return await newJob.save();
};

export const getJob = async ({jobId}) => {
  return await Job.findById(jobId);
};

export const updateJob = async ({jobId, title, instructions, milestones}) => {
  return await Job.findByIdAndUpdate(jobId, { title, instructions, milestones }, { new: true });
};

export const deleteJob = async ({jobId}) => {
  return await Job.findByIdAndDelete(jobId);
};

export const executeJob = async ({jobId}) => {
  const job = await Job.findById(jobId);
  if (!job) {
    throw new Error('Job not found');
  }
  else {
    // Execute the job here
    // ...
    console.log( { status: 'success', message: 'Job executed successfully' } );
  }
};