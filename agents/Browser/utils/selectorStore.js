import { ChromaClient } from "chromadb";
import dotenv from "dotenv";
import uniqueId from "./uniqueId.js";
dotenv.config();
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const vectorStore = new ChromaClient();
function reformatData(identifiers) {
  return identifiers.reduce(
    (sum, identifier) => {
      const { elementName, elementFunctionality, id = uniqueId(), doc } = identifier;
      delete identifier.doc;
      identifier.id = id;
      sum.documents.push(doc ? doc : `${elementName}: ${elementFunctionality}`);
      sum.ids.push(identifier.id);
      sum.metadatas.push(identifier);
      return sum;
    },
    {
      ids: [],
      documents: [],
      metadatas: [],
    }
  );
}
async function getCollection(domain) {
  try {
    return await vectorStore.getCollection({
      name: domain,
      embeddingFunction: embeddingFunction(),
      metadata: { "hnsw:space": "cosine" },
    });
  } catch (error) {}
}
export async function save(domain, identifiers) {
  const collection = await vectorStore.getOrCreateCollection({
    name: domain,
    embeddingFunction: embeddingFunction(),
    metadata: { "hnsw:space": "cosine" },
  });
  console.log("saving selectors", domain, identifiers);
  const embeddingData = reformatData(identifiers);
  await collection.upsert(embeddingData);
  return identifiers;
}
export async function get(domain, where = {}) {
  const collection = await vectorStore.getOrCreateCollection({
    name: domain,
    embeddingFunction: embeddingFunction(),
    metadata: { "hnsw:space": "cosine" },
  });
  console.log("saving selectors", domain);
  const { metadatas, ids } = await collection.get({ where, include: ["metadatas"] });
  return metadatas.map((data, i) => ({ ...data, id: ids[i] }));
}

export async function search(domain, description, nResults = 5, where) {
  const collection = await getCollection(domain);
  console.log("search", domain, description, nResults, where);
  if (collection) {
    const results = await collection.query({ queryTexts: description, nResults, where });
    console.log("search results", results);
    return {
      results: results.metadatas[0],
      distances: results.distances[0],
    };
  }
  console.log("collection not found", domain, description);
  return { results: [], distances: [] };
}
export async function clear(domain) {
  try {
    await vectorStore.deleteCollection({ name: domain });
  } catch (error) {
    console.log(error);
  }
}
export async function quickSearch(identifiers, queryTexts, where, nResults) {
  const embeddingData = reformatData(identifiers);
  const name = `temp-${uniqueId()}`;
  const collection = await vectorStore.createCollection({
    name,
    embeddingFunction: embeddingFunction(),
    metadata: { "hnsw:space": "cosine" },
  });

  console.log("added Collection", name, embeddingData);
  try {
    await collection.add(embeddingData);
  } catch (error) {
    console.log("collection.add error", error);
    throw error;
  }

  try {
    const results = await collection.query({
      queryTexts,
      nResults: nResults || identifiers.length,
      where,
    });
    if (results.error) {
      console.log("results.error", results.error, results.error.body);
    }
    console.log("quickSearch results", name, queryTexts, results, results.metadatas);
    clear(name);
    return {
      results: results.metadatas[0],
      distances: results.distances[0],
    };
  } catch (error) {
    console.log("collection.query error", error);
    throw error;
  }
}

export async function directSearch(docs, queryTexts) {
  const embeddingData = docs.reduce(
    (sum, text, i) => {
      sum.documents.push(text);
      sum.ids.push(`id${i}`);
      sum.metadatas.push({ text });
      return sum;
    },
    {
      ids: [],
      documents: [],
      metadatas: [],
    }
  );

  const name = `temp-${uniqueId()}`;
  const collection = await vectorStore.createCollection({
    name,
    embeddingFunction: embeddingFunction(),
    metadata: { "hnsw:space": "cosine" },
  });

  console.log("added Collection", name, embeddingData);
  try {
    await collection.add(embeddingData);
  } catch (error) {
    console.log("collection.add error", error);
    throw error;
  }

  try {
    const results = await collection.query({ queryTexts, nResults: docs.length });
    if (results.error) {
      console.log("results.error", results.error, results.error.body);
    }
    console.log("quickSearch results", name, queryTexts, results, results.metadatas);
    clear(name);

    return {
      results: results.metadatas[0],
      distances: results.distances[0],
    };
  } catch (error) {
    console.log("collection.query error", error);
    throw error;
  }
}
function embeddingFunction() {
  return {
    generate: async function getEmbeddings(input) {
      console.log("input", input);
      if (!input.length) return [];
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input,
        encoding_format: "float",
      });
      //console.log(response);
      return response.data.map(({ embedding }) => embedding);
    },
  };
}
const selectorStore = { save, search, quickSearch, clear, get };
export default selectorStore;

// get("ebay_com").then(console.log).catch(console.error);
// const phrases = [
//   "Creating the future we dreamed of, today.",
//   "Bringing the envisioned future into the present.",
//   "Transforming today's world into tomorrow's vision.",
//   "Making the future we've always wanted a reality.",
//   "Realizing the future we've imagined, now.",
//   "Turning our future aspirations into today's reality.",
//   "Delivering the future we hoped for, in the present.",
//   "Building the future we aspired to, today.",
//   "Achieving the future we planned for, now.",
//   "Bringing tomorrow's innovations to life today.",
// ];
// // directSearch(phrases, "Transforming our dreams of tomorrow into today's reality.")
// //   .then(console.log)
// //   .catch(console.error);
// Promise.all([
//   directSearch(phrases, "Transforming our dreams of tomorrow into today's reality."),
//   directSearch(phrases, "Transforming our dreams of tomorrow into today's reality."),
//   directSearch(phrases, "Transforming our dreams of tomorrow into today's reality."),
//   directSearch(phrases, "Transforming our dreams of tomorrow into today's reality."),
// ])
//   .then(console.log)
//   .catch(console.error);
