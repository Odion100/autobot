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
        additionalSelectors = [],
      } = identifier;
      if (!identifier.id) identifier.id = uniqueId();
      sum.documents.push(`${label}: ${description}`);
      sum.ids.push(identifier.id);
      sum.metadatas.push({
        label,
        description,
        selector,
        container,
        type,
        additionalSelectors,
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
    });
  } catch (error) {}
}
export async function save(domain, identifiers) {
  const collection = await vectorStore.getOrCreateCollection({
    name: domain,
    embeddingFunction: embeddingFunction(),
  });
  const embeddingData = reformatData(identifiers);
  await collection.upsert(embeddingData);
  return identifiers;
}

export async function search(domain, description, nResults = 5, where) {
  const collection = await getCollection(domain);
  console.log("search", domain, description, nResults, where);
  if (collection) {
    const results = await collection.query({
      queryTexts: description,
      nResults,
    });
    console.log("search results", results);
    return {
      results: results.metadatas[0],
      distances: results.distances[0],
    };
  }
  return { results: [], distances: [] };
}
export async function clear(domain) {
  try {
    await vectorStore.deleteCollection({ name: domain });
  } catch (error) {
    console.log(error);
  }
}
export async function quickSearch(identifiers, queryTexts, nResults = 1) {
  const embeddingData = reformatData(identifiers);
  console.log("quickSearch ->", embeddingData, identifiers, queryTexts);
  await clear("temp");
  const collection = await vectorStore.createCollection({
    name: "temp",
    embeddingFunction: embeddingFunction(),
    metadata: { "hnsw:space": "cosine" },
  });
  await collection.add(embeddingData);
  const results = await collection.query({ queryTexts, nResults });
  return {
    results: results.metadatas[0],
    distances: results.distances[0],
  };
}

function embeddingFunction() {
  return {
    generate: async function getEmbeddings(input) {
      console.log("input", input);
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
