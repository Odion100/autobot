import { ChromaClient } from "chromadb";
import dotenv from "dotenv";

dotenv.config();
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const vectorStore = new ChromaClient();

export async function save(url, selector, description) {
  const domain = parseDomain(url);
  const collection = await vectorStore.getOrCreateCollection({
    name: domain,
    embeddingFunction: embeddingFunction(),
  });
  await collection.upsert({
    ids: [description],
    documents: [description],
    metadatas: [selector],
  });
}
export async function get(url, description, nResults = 3) {
  const domain = parseDomain(url);
  const collection = await vectorStore.getOrCreateCollection({
    name: domain,
    embeddingFunction: embeddingFunction(),
  });
  const results = await collection.query({ queryTexts: description, nResults });
  console.log("get results", results);
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
