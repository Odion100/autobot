import { connectToMongoDB } from './db/connection.js';
import { createJob, getJob, updateJob, deleteJob } from './db/operations/jobOperations.js';

async function runTests() {
  try {
    await connectToMongoDB();
    console.log('Connected to MongoDB');

    const newJob = await createJob('Test Job', 'Test Instructions', ['Milestone 1', 'Milestone 2']);
    console.log('Created job:', newJob);

    const retrievedJob = await getJob(newJob._id);
    console.log('Retrieved job:', retrievedJob);

    const updatedJob = await updateJob(newJob._id, 'Updated Job', 'Updated Instructions', ['Updated Milestone 1', 'Updated Milestone 2']);
    console.log('Updated job:', updatedJob);

    const deletedJob = await deleteJob(newJob._id);
    console.log('Deleted job:', deletedJob);

    const shouldBeNull = await getJob(newJob._id);
    console.log('Attempt to retrieve deleted job:', shouldBeNull);

    console.log('All tests completed successfully');
  } catch (error) {
    console.error('Error during tests:', error);
  } finally {
    process.exit();
  }
}

runTests();
