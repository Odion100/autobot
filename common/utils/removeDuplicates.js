export function removeDuplicates(arr, prop) {
  const uniqueValues = new Set();
  return arr.filter((item) => {
    if (uniqueValues.has(item[prop])) {
      return false;
    } else {
      uniqueValues.add(item[prop]);
      return true;
    }
  });
}
