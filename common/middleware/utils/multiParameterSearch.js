import driver from "../../driver/index.js";
import { uniqueId } from "../../utils/index.js";

export async function multiParameterSearch(identifiers, args, filter) {
  const params = [
    "elementName",
    "elementFunctionality",
    "containerName",
    "containerFunctionality",
  ];
  console.log(
    "multiParameterSearch identifiers, args, filter",
    identifiers,
    args,
    filter
  );
  for (const identifier of identifiers) {
    if (!identifier.id) identifier.id = uniqueId();
    identifier.totalDistance = 0;
    identifier.totalSearches = 0;
  }
  async function paramSearch(param) {
    const filteredIdentifiers = identifiers.reduce((acc, identifier) => {
      if (identifier[param] && args[param]) {
        acc.push({ ...identifier, doc: identifier[param] });
      }
      return acc;
    }, []);
    // console.log("filteredIdentifiers, param", filteredIdentifiers, param);
    const searchTerm = args[param];
    const { results, distances } = await driver.compareIdentifiers(
      filteredIdentifiers,
      searchTerm,
      filter
    );
    results.forEach(({ id }, i) => {
      const identifier = identifiers.find((item) => item.id === id);
      identifier.totalDistance += distances[i];
      identifier.totalSearches++;
    });
  }
  await Promise.all(params.map((param) => paramSearch(param)));
  return {
    results: identifiers,
    distances: identifiers.map(
      ({ totalDistance, totalSearches }) => totalDistance / totalSearches
    ),
  };
}
