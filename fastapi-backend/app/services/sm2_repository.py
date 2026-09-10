"""
sm2_repository.py

Bridges the pure sm2_service algorithm to a live DB session.

This is deliberately NOT a FastAPI route — that's Task 3's job
("Create revision planner FastAPI endpoints", "Connect SM-2 engine
with database"). This file just gives Task 3 two clean functions to
call, so the route handlers stay thin:

    schedule = get_or_create_schedule(db, student_id, subject, topic)
    schedule = apply_review(db, schedule, quality=4)
"""

import uuid
from datetime import date
from sqlalchemy.orm import Session

from .sm2_service import SM2State, review as sm2_review
from database.models import RevisionSchedule, RevisionHistory


def get_or_create_schedule(db: Session, student_id: uuid.UUID, subject: str, topic: str) -> RevisionSchedule:
    """
    Fetch the current schedule row for this (student, subject, topic),
    or create a fresh one seeded at sm2_initial_ef=2.5 if this is the
    topic's first-ever review.
    """
    schedule = (
        db.query(RevisionSchedule)
        .filter_by(student_id=student_id, subject=subject, topic=topic)
        .first()
    )
    if schedule is None:
        schedule = RevisionSchedule(
            student_id=student_id,
            subject=subject,
            topic=topic,
            repetition_number=0,
            easiness_factor=2.5,
            interval_days=0,
            next_review_date=date.today(),
        )
        db.add(schedule)
        db.commit()
        db.refresh(schedule)
    return schedule


def apply_review(db: Session, schedule: RevisionSchedule, quality: int) -> RevisionSchedule:
    """
    Score a review against an existing schedule row:
      1. Run the pure SM-2 calculation.
      2. Write a RevisionHistory row capturing before/after state.
      3. Overwrite RevisionSchedule with the new state.
      4. Commit both in one transaction.
    """
    before_state = SM2State(
        repetition_number=schedule.repetition_number,
        easiness_factor=schedule.easiness_factor,
        interval_days=schedule.interval_days,
    )

    result = sm2_review(before_state, quality)
    new_state = result.new_state

    history_row = RevisionHistory(
        schedule_id=schedule.id,
        quality=quality,
        was_success=result.was_success,
        easiness_factor_before=before_state.easiness_factor,
        interval_days_before=before_state.interval_days,
        repetition_number_before=before_state.repetition_number,
        easiness_factor_after=new_state.easiness_factor,
        interval_days_after=new_state.interval_days,
        repetition_number_after=new_state.repetition_number,
    )
    db.add(history_row)

    schedule.repetition_number = new_state.repetition_number
    schedule.easiness_factor = new_state.easiness_factor
    schedule.interval_days = new_state.interval_days
    schedule.next_review_date = new_state.next_review_date
    schedule.last_reviewed_at = history_row.reviewed_at

    db.commit()
    db.refresh(schedule)
    return schedule