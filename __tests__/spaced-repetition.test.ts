import { describe, it, expect } from "vitest"
import { calculateNextReview, createInitialSchedule } from "../lib/spaced-repetition"
import { ReviewSchedule } from "../lib/types"

const baseSchedule: ReviewSchedule = {
  pageKey: "test-page",
  conceptName: "测试概念",
  nextReviewAt: Date.now(),
  interval: 1,
  easeFactor: 2.5,
  reviewCount: 0,
  lastReviewAt: null,
}

describe("createInitialSchedule", () => {
  it("creates schedule with correct defaults", () => {
    const schedule = createInitialSchedule("page-1", "概念A")
    expect(schedule.pageKey).toBe("page-1")
    expect(schedule.conceptName).toBe("概念A")
    expect(schedule.interval).toBe(1)
    expect(schedule.easeFactor).toBe(2.5)
    expect(schedule.reviewCount).toBe(0)
    expect(schedule.lastReviewAt).toBeNull()
    expect(schedule.nextReviewAt).toBeGreaterThan(Date.now() - 1000)
  })

  it("sets nextReviewAt to approximately 1 day from now", () => {
    const before = Date.now() + 86400000 - 100
    const schedule = createInitialSchedule("p", "c")
    const after = Date.now() + 86400000 + 100
    expect(schedule.nextReviewAt).toBeGreaterThan(before)
    expect(schedule.nextReviewAt).toBeLessThan(after)
  })
})

describe("calculateNextReview", () => {
  it("resets interval to 1 on 'again' quality", () => {
    const schedule = { ...baseSchedule, interval: 10, reviewCount: 5 }
    const result = calculateNextReview(schedule, "again")
    expect(result.interval).toBe(1)
    expect(result.reviewCount).toBe(6)
    expect(result.easeFactor).toBeLessThan(schedule.easeFactor)
  })

  it("does not let easeFactor drop below 1.3 on 'again'", () => {
    const schedule = { ...baseSchedule, easeFactor: 1.3, interval: 5 }
    const result = calculateNextReview(schedule, "again")
    expect(result.easeFactor).toBe(1.3)
  })

  it("increases interval by 1.2x on 'hard' quality", () => {
    const schedule = { ...baseSchedule, interval: 5, reviewCount: 3 }
    const result = calculateNextReview(schedule, "hard")
    expect(result.interval).toBe(Math.max(1, Math.ceil(5 * 1.2)))
    expect(result.easeFactor).toBeLessThan(schedule.easeFactor)
  })

  it("sets interval to 1 on first 'good' review", () => {
    const schedule = { ...baseSchedule, reviewCount: 0 }
    const result = calculateNextReview(schedule, "good")
    expect(result.interval).toBe(1)
    expect(result.reviewCount).toBe(1)
  })

  it("sets interval to 3 on second 'good' review", () => {
    const schedule = { ...baseSchedule, reviewCount: 1, interval: 1 }
    const result = calculateNextReview(schedule, "good")
    expect(result.interval).toBe(3)
    expect(result.reviewCount).toBe(2)
  })

  it("multiplies interval by easeFactor on subsequent 'good' reviews", () => {
    const schedule = { ...baseSchedule, reviewCount: 3, interval: 3, easeFactor: 2.5 }
    const result = calculateNextReview(schedule, "good")
    expect(result.interval).toBe(Math.ceil(3 * 2.5))
  })

  it("sets interval to 4 on first 'easy' review", () => {
    const schedule = { ...baseSchedule, reviewCount: 0 }
    const result = calculateNextReview(schedule, "easy")
    expect(result.interval).toBe(4)
    expect(result.easeFactor).toBeGreaterThan(schedule.easeFactor)
  })

  it("multiplies interval by easeFactor * 1.3 on subsequent 'easy' reviews", () => {
    const schedule = { ...baseSchedule, reviewCount: 2, interval: 3, easeFactor: 2.5 }
    const result = calculateNextReview(schedule, "easy")
    expect(result.interval).toBe(Math.ceil(3 * 2.5 * 1.3))
  })

  it("does not let easeFactor exceed 3.0 on 'easy'", () => {
    const schedule = { ...baseSchedule, easeFactor: 2.95, reviewCount: 1 }
    const result = calculateNextReview(schedule, "easy")
    expect(result.easeFactor).toBeLessThanOrEqual(3.0)
  })

  it("sets lastReviewAt to current time", () => {
    const before = Date.now()
    const result = calculateNextReview(baseSchedule, "good")
    const after = Date.now()
    expect(result.lastReviewAt).toBeGreaterThanOrEqual(before)
    expect(result.lastReviewAt).toBeLessThanOrEqual(after)
  })

  it("sets nextReviewAt based on interval", () => {
    const result = calculateNextReview(baseSchedule, "good")
    const expectedNext = result.lastReviewAt! + result.interval * 86400000
    expect(result.nextReviewAt).toBe(expectedNext)
  })

  it("preserves pageKey and conceptName", () => {
    const result = calculateNextReview(baseSchedule, "good")
    expect(result.pageKey).toBe(baseSchedule.pageKey)
    expect(result.conceptName).toBe(baseSchedule.conceptName)
  })
})
