"""
sm2_service.py

Pure implementation of the SM-2 spaced repetition algorithm
(Piotr Wozniak / SuperMemo-2, 1987 version).

Deliberately has ZERO database or FastAPI imports. It takes plain
numbers in, returns plain numbers out. This makes it trivial to unit
test and keeps it reusable later by the Task Generator (Task 2) and
the API layer (Task 3) without those layers needing to know HOW the
schedule is computed.

Reference config from the PRD (F5 Revision Planner):
    sm2_initial_ef = 2.5
"""

from dataclasses import dataclass
from datetime import date, timedelta

# ---- Constants -------------------------------------------------------

# Starting easiness factor for a topic that has never been reviewed.
# Matches PRD config: sm2_initial_ef=2.5
INITIAL_EASINESS_FACTOR = 2.5

# SM-2 never lets EF drop below this — below ~1.3 the algorithm would
# start scheduling reviews *more* often than the base interval, which
# defeats the point of spacing things out.
MIN_EASINESS_FACTOR = 1.3

# Quality scale is 0-5 (classic SuperMemo scale):
#   5 = perfect recall, effortless
#   4 = correct, after some hesitation
#   3 = correct, but it was a struggle to recall
#   2 = incorrect, but the answer felt familiar
#   1 = incorrect, remembered after seeing the answer
#   0 = complete blackout, no recognition at all
# Anything below QUALITY_PASS_THRESHOLD is treated as a failed
# recall and resets the repetition streak.
QUALITY_PASS_THRESHOLD = 3
MIN_QUALITY = 0
MAX_QUALITY = 5


@dataclass
class SM2State:
    """The scheduling state for one (student, topic) pair.

    This is the shape that gets persisted to Postgres — see
    RevisionSchedule in models.py. Keeping it as a dataclass here
    (rather than importing the SQLAlchemy model) is what keeps this
    file dependency-free.
    """
    repetition_number: int = 0            # how many *consecutive* successful reviews
    easiness_factor: float = INITIAL_EASINESS_FACTOR
    interval_days: int = 0                # days until next review, from last review
    next_review_date: date = None         # computed field, convenience only


@dataclass
class SM2Result:
    """What you get back after scoring one review."""
    new_state: SM2State
    was_success: bool                     # quality >= QUALITY_PASS_THRESHOLD


def _validate_quality(quality: int) -> None:
    if not isinstance(quality, int):
        raise TypeError(f"quality must be an int, got {type(quality).__name__}")
    if not (MIN_QUALITY <= quality <= MAX_QUALITY):
        raise ValueError(
            f"quality must be between {MIN_QUALITY} and {MAX_QUALITY}, got {quality}"
        )


def calculate_easiness_factor(previous_ef: float, quality: int) -> float:
    """
    Core SM-2 EF update formula:

        EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))

    Intuition: a perfect answer (q=5) leaves EF unchanged (adds 0.1... wait,
    actually adds +0.1 -- easy cards get *slightly* easier). A poor-but-passing
    answer (q=3) pulls EF down noticeably. EF is then floored at 1.3 so it
    never spirals into absurdly short intervals.
    """
    _validate_quality(quality)
    ef = previous_ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    return max(ef, MIN_EASINESS_FACTOR)


def calculate_interval(repetition_number: int, previous_interval: int, easiness_factor: float) -> int:
    """
    Core SM-2 interval formula, applied AFTER repetition_number has already
    been incremented for a successful review:

        n=1 -> interval = 1 day
        n=2 -> interval = 6 days
        n>2 -> interval = round(previous_interval * EF)

    previous_interval is the interval that was used to schedule the review
    that was *just* completed (0 for a topic's very first review).
    """
    if repetition_number <= 0:
        raise ValueError("repetition_number must be >= 1 when calculating an interval")

    if repetition_number == 1:
        return 1
    elif repetition_number == 2:
        return 6
    else:
        return round(previous_interval * easiness_factor)


def calculate_next_review_date(interval_days: int, from_date: date = None) -> date:
    """Next review date = today (or a given reference date) + interval_days."""
    reference = from_date or date.today()
    return reference + timedelta(days=interval_days)


def review(state: SM2State, quality: int, review_date: date = None) -> SM2Result:
    """
    Score one review and return the updated scheduling state.

    This is the single entry point Task 2/3 should call:

        new_result = sm2_service.review(current_state, quality=4)
        # persist new_result.new_state to RevisionSchedule
        # append a RevisionHistory row for the audit trail

    quality < QUALITY_PASS_THRESHOLD (i.e. 0, 1, or 2):
        -> treated as a failed recall. Repetition streak resets to 0,
           EF still updates (a bad answer still makes EF drop), and the
           topic is scheduled to come back TOMORROW (interval = 1) so it
           gets reinforced quickly rather than falling further behind.

    quality >= QUALITY_PASS_THRESHOLD (3, 4, or 5):
        -> repetition streak increments, interval grows per the SM-2 curve.
    """
    _validate_quality(quality)
    review_date = review_date or date.today()

    new_ef = calculate_easiness_factor(state.easiness_factor, quality)
    was_success = quality >= QUALITY_PASS_THRESHOLD

    if not was_success:
        new_repetition = 0
        new_interval = 1
    else:
        new_repetition = state.repetition_number + 1
        new_interval = calculate_interval(new_repetition, state.interval_days, new_ef)

    new_state = SM2State(
        repetition_number=new_repetition,
        easiness_factor=new_ef,
        interval_days=new_interval,
        next_review_date=calculate_next_review_date(new_interval, review_date),
    )

    return SM2Result(new_state=new_state, was_success=was_success)


def derive_quality_from_attempt(is_correct: bool, hints_used: int = 0, time_ms: int = None,
                                 expected_time_ms: int = None) -> int:
    """
    Convenience helper to turn a quiz Attempt (correct/hints_used/time_ms —
    see the Attempt entity in the PRD's data design) into a 0-5 SM-2 quality
    score, since students never self-rate "how well did you recall this."

    This is intentionally simple for now — Task 2 (Study Task Generator) is
    where this gets wired into real Attempt records and can be tuned. Treat
    this as a starting heuristic, not the final mapping:

        wrong                          -> 1
        correct, but needed hints      -> 3
        correct, slower than expected  -> 4
        correct, at/under expected time-> 5
    """
    if not is_correct:
        return 1
    if hints_used > 0:
        return 3
    if expected_time_ms and time_ms and time_ms > expected_time_ms:
        return 4
    return 5