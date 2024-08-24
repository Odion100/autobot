export const wait = (timeout = 0) =>
  new Promise((resolve) => setTimeout(() => resolve(new Date()), timeout));
