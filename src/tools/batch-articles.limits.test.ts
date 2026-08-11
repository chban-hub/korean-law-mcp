import { describe, expect, it } from "vitest"
import {
  GetBatchArticlesSchema,
  MAX_ARTICLES_PER_LAW,
  MAX_BATCH_ARTICLES,
  MAX_BATCH_LAWS,
} from "./batch-articles.js"

describe("get_batch_articles execution boundaries", () => {
  it("permits a documented bounded multi-law request", () => {
    const parsed = GetBatchArticlesSchema.parse({
      laws: Array.from({ length: 2 }, (_, index) => ({
        mst: String(index + 1),
        articles: ["제1조", "제2조"],
      })),
    })
    expect(parsed.laws).toHaveLength(2)
  })

  it("rejects unbounded law fan-out before any API or cache work", () => {
    expect(() => GetBatchArticlesSchema.parse({
      laws: Array.from({ length: MAX_BATCH_LAWS + 1 }, (_, index) => ({ mst: String(index), articles: ["제1조"] })),
    })).toThrow()
  })

  it("bounds nested articles and the total request article count", () => {
    expect(() => GetBatchArticlesSchema.parse({
      mst: "1",
      articles: Array.from({ length: MAX_ARTICLES_PER_LAW + 1 }, () => "제1조"),
    })).toThrow()

    expect(() => GetBatchArticlesSchema.parse({
      laws: Array.from({ length: MAX_BATCH_LAWS }, (_, index) => ({
        mst: String(index),
        articles: Array.from({ length: 6 }, () => "제1조"),
      })),
    })).toThrow(`최대 ${MAX_BATCH_ARTICLES}개`)
  })
})
