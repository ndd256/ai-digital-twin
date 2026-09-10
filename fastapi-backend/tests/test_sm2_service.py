"""
test_sm2_service.py

These tests target sm2_service ONLY (no DB) since that's where the
actual algorithm risk lives — the repository layer is a thin pass-
through you can sanity-check manually against Postgres once this
passes.

Run with: pytest test_sm2_service.py -v
"""

from datetime import date, timedelta

import pytest

from sm2_service import (
    SM2State,
    review,
    calculate_easiness_factor,
    calculate_interval,
    calculate_next_review_date,
    derive_quality_from_attempt,
    MIN_EASINESS_FACTOR,
)


def test_first_successful_review_sets_interval_to_1_day():
    state = SM2State()  # brand new topic: n=0, EF=2.5, interval=0
    result = review(state, quality=4)

    assert result.was_success is True
    assert result.new_state.repetition_number == 1
    assert result.new_state.interval_days == 1


def test_second_successful_review_sets_interval_to_6_days():
    state = SM2State(repetition_number=1, easiness_factor=2.5, interval_days=1)
    result = review(state, quality=4)

    assert result.new_state.repetition_number == 2
    assert result.new_state.interval_days == 6


def test_third_successful_review_uses_ef_multiplier():
    state = SM2State(repetition_number=2, easiness_factor=2.5, interval_days=6)
    result = review(state, quality=5)

    # interval = round(previous_interval * new_ef)
    expected_ef = calculate_easiness_factor(2.5, 5)
    expected_interval = round(6 * expected_ef)
    assert result.new_state.interval_days == expected_interval


def test_failed_review_resets_repetition_streak():
    state = SM2State(repetition_number=4, easiness_factor=2.3, interval_days=20)
    result = review(state, quality=1)  # below QUALITY_PASS_THRESHOLD

    assert result.was_success is False
    assert result.new_state.repetition_number == 0
    assert result.new_state.interval_days == 1  # back to reviewing tomorrow


def test_easiness_factor_never_drops_below_floor():
    ef = 1.3
    for _ in range(20):
        ef = calculate_easiness_factor(ef, quality=0)  # repeatedly fail hard
    assert ef == MIN_EASINESS_FACTOR


def test_perfect_quality_slightly_increases_ef():
    new_ef = calculate_easiness_factor(2.5, quality=5)
    assert new_ef > 2.5


def test_next_review_date_is_from_date_plus_interval():
    ref = date(2026, 1, 1)
    assert calculate_next_review_date(6, from_date=ref) == ref + timedelta(days=6)


def test_review_uses_given_review_date_not_todays_date():
    state = SM2State()
    fixed_date = date(2026, 3, 1)
    result = review(state, quality=5, review_date=fixed_date)
    assert result.new_state.next_review_date == fixed_date + timedelta(days=1)


@pytest.mark.parametrize("quality", [-1, 6, 10])
def test_invalid_quality_raises(quality):
    state = SM2State()
    with pytest.raises(ValueError):
        review(state, quality=quality)


def test_derive_quality_from_attempt_wrong_answer():
    assert derive_quality_from_attempt(is_correct=False) == 1


def test_derive_quality_from_attempt_correct_with_hints():
    assert derive_quality_from_attempt(is_correct=True, hints_used=2) == 3


def test_derive_quality_from_attempt_correct_fast():
    assert derive_quality_from_attempt(
        is_correct=True, hints_used=0, time_ms=5000, expected_time_ms=10000
    ) == 5


def test_calculate_interval_requires_positive_repetition():
    with pytest.raises(ValueError):
        calculate_interval(repetition_number=0, previous_interval=1, easiness_factor=2.5)