import { ChromaClient } from "chromadb";
import dotenv from "dotenv";
import uniqueId from "./uniqueId.js";
dotenv.config();
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const vectorStore = new ChromaClient();

export async function save(url, selectors) {
  const domain = parseDomain(url);
  const collection = await vectorStore.getOrCreateCollection({
    name: domain,
    embeddingFunction: embeddingFunction(),
  });
  const embeddingData = selectors.reduce(
    (sum, { id = uniqueId(), label, description, ...rest }) => {
      sum.documents.push(`${label}: ${description}`);
      sum.ids.push(id);
      sum.metadatas.push(rest);
      return sum;
    },
    {
      ids: [],
      documents: [],
      metadatas: [],
    }
  );
  await collection.upsert(embeddingData);
}

export async function get(url, description, nResults = 3) {
  const domain = parseDomain(url);
  const collection = await vectorStore.getCollection({
    name: domain,
    embeddingFunction: embeddingFunction(),
  });
  if (collection) {
    const results = await collection.query({ queryTexts: description, nResults });
    console.log("get results", results);
    return results.metadatas[0];
  }
  return [];
}
export async function quickSearch(selectors, queryTexts, nResults = 3) {
  const embeddingData = selectors.reduce(
    (sum, { label, description, ...rest }, i) => {
      sum.documents.push(description);
      sum.ids.push(`id${i}`);
      sum.metadatas.push(rest);
      return sum;
    },
    {
      ids: [],
      documents: [],
      metadatas: [],
    }
  );
  try {
    await vectorStore.deleteCollection({
      name: "temp",
    });
  } catch (error) {
    console.log(error);
  }
  const collection = await vectorStore.createCollection({
    name: "temp",
    embeddingFunction: embeddingFunction(),
    metadata: { "hnsw:space": "cosine" },
  });
  await collection.add(embeddingData);
  const results = await collection.query({ queryTexts, nResults });
  return results.metadatas[0];
}
function parseDomain(url) {
  // Regular expression to match domain from URL
  var domainRegex = /^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)/gi;

  // Executing the regex on the URL
  var matches = domainRegex.exec(url);

  // Extracting the domain from the matched groups
  var domain = matches && matches.length > 1 ? matches[1] : null;

  return domain.replace(".", "_");
}
async function getEmbeddings(input) {
  console.log("input", input);
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input,
    encoding_format: "float",
  });
  //console.log(response);
  return response.data.map(({ embedding }) => embedding);
}
function embeddingFunction() {
  const fn = {};
  fn.generate = getEmbeddings;
  return fn;
}
const selectorStore = { save, get };
export default selectorStore;
