import { ChromaClient } from "chromadb";
import puppeteer from "puppeteer";
import cheerio from "cheerio";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
dotenv.config();
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// console.log(chromadb);

const vectorStore = new ChromaClient();

async function naturalLanguageSelector(queryTexts = [], nResults = 3) {
  try {
    await vectorStore.deleteCollection({
      name: "test1",
    });
  } catch (error) {
    console.log(error);
  }
  const collection = await vectorStore.createCollection({
    name: "test1",
    embeddingFunction: embeddingFunction(),
  });
  await collection.add({
    ids: ["id1", "id2"],
    documents: ["singular", "plural"],
    metadatas: [{ name: "singular" }, { name: "plural" }],
  });
  return await collection.query({ queryTexts, nResults });
}

async function getEmbeddings(input) {
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

naturalLanguageSelector(["a search result", "the listing", "dogs", "man", "women"], 2)
  .then(async (res) => {
    console.log("results -->", res);
    //await vectorStore.reset();
  })
  .catch(console.error);
