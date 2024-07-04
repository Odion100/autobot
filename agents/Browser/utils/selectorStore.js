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
      const {
        label,
        description,
        selector,
        container,
        type,
        id = uniqueId(),
      } = identifier;

      identifier.id = id;
      sum.documents.push(`${label}: ${description}`);
      sum.ids.push(identifier.id);
      sum.metadatas.push({
        id,
        label,
        description,
        selector,
        container,
        type,
      });
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
export async function quickSearch(identifiers, queryTexts, nResults = 1, where) {
  const embeddingData = reformatData(identifiers);
  await clear("temp");
  const collection = await vectorStore.createCollection({
    name: "temp",
    embeddingFunction: embeddingFunction(),
    metadata: { "hnsw:space": "cosine" },
  });
  await collection.add(embeddingData);
  const results = await collection.query({ queryTexts, nResults, where });
  console.log("quickSearch results", results, results.metadatas);
  return {
    results: results.metadatas[0],
    distances: results.distances[0],
  };
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
const selectorStore = { save, search, quickSearch, clear };
export default selectorStore;
Promise.all(
  [
    {
      name: "amazon_com",
      id: "d86e1227-fb6f-4dfe-b743-9c36e08ee01d",
      metadata: {
        "hnsw:space": "cosine",
      },
      tenant: "default_tenant",
      database: "default_database",
    },
  ].map(({ name }) => clear(name))
);
