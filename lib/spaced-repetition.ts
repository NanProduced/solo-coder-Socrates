import { ReviewSchedule, ReviewQuality } from "./types"

const DAY_MS = 86400000

export function calculateNextReview(
  schedule: ReviewSchedule,
  quality: ReviewQuality
): ReviewSchedule {
  let { interval, easeFactor, reviewCount } = schedule

  reviewCount++

  switch (quality) {
    case "again":
      interval = 1
      easeFactor = Math.max(1.3, easeFactor - 0.2)
      break
    case "hard":
      interval = Math.max(1, Math.ceil(interval * 1.2))
      easeFactor = Math.max(1.3, easeFactor - 0.15)
      break
    case "good":
      if (reviewCount === 1) {
        interval = 1
      } else if (reviewCount === 2) {
        interval = 3
      } else {
        interval = Math.ceil(interval * easeFactor)
      }
      break
    case "easy":
      if (reviewCount === 1) {
        interval = 4
      } else {
        interval = Math.ceil(interval * easeFactor * 1.3)
      }
      easeFactor = Math.min(3.0, easeFactor + 0.15)
      break
  }

  return {
    ...schedule,
    interval,
    easeFactor,
    reviewCount,
    lastReviewAt: Date.now(),
    nextReviewAt: Date.now() + interval * DAY_MS,
  }
}

export function createInitialSchedule(
  pageKey: string,
  conceptName: string
): ReviewSchedule {
  return {
    pageKey,
    conceptName,
    nextReviewAt: Date.now() + DAY_MS,
    interval: 1,
    easeFactor: 2.5,
    reviewCount: 0,
    lastReviewAt: null,
  }
}
