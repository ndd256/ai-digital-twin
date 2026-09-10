from datetime import date, datetime, timedelta, timezone
from sqlalchemy.orm import Session
import uuid

from database.models import (
    RevisionSchedule,
    StudentRevisionSettings,
    StudentMastery,
    StudentMasteryHistory
)
from app.services.struggle_service import get_top_struggles

# ============================================================
# SM-2 SPACED REPETITION ALGORITHM
# ============================================================

def calculate_sm2(repetition: int, ease_factor: float, interval_days: int, quality: int):
    """
    SuperMemo-2 (SM-2) Spaced Repetition Algorithm.

    Quality scale (0 to 5):
    5: Perfect response
    4: Correct response after a hesitation
    3: Correct response recalled with serious difficulty
    2: Incorrect response; correct answer seemed easy to remember
    1: Incorrect response; correct answer remembered
    0: Complete blackout

    Returns: (new_repetition, new_ease_factor, new_interval_days)
    """
    quality = max(0, min(5, int(quality)))

    # Ease factor formula
    new_ef = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    if new_ef < 1.3:
        new_ef = 1.3
    new_ef = round(new_ef, 3)

    if quality < 3:
        # Failed review: reset repetitions and schedule for immediate review (1 day)
        new_repetition = 0
        new_interval = 1
    else:
        # Successful review
        if repetition == 0:
            new_interval = 1
        elif repetition == 1:
            new_interval = 6
        else:
            new_interval = round(interval_days * new_ef)
        new_repetition = repetition + 1

    return new_repetition, new_ef, max(1, new_interval)


def determine_priority(struggle_score: float, is_overdue: bool = False) -> str:
    """
    Assign priority level to a revision topic.
    """
    if struggle_score >= 1.0 or is_overdue:
        return "HIGH"
    elif struggle_score >= 0.5:
        return "MEDIUM"
    else:
        return "LOW"


def estimate_study_minutes(struggle_score: float, syllabus_weight: float = 1.0) -> int:
    """
    Estimate study duration in minutes for a topic based on struggle score & weight.
    Range: 10 to 30 minutes (default 15).
    """
    base_mins = 15
    adjusted = base_mins * (1.0 + (struggle_score * 0.5)) * syllabus_weight
    return min(30, max(10, int(round(adjusted))))


# ============================================================
# WORKLOAD SETTINGS & REVISION PLAN GENERATOR
# ============================================================

def get_or_create_settings(db: Session, student_id: str) -> StudentRevisionSettings:
    """
    Get student's revision settings (e.g., max daily minutes) or create default.
    """
    settings = db.query(StudentRevisionSettings).filter(
        StudentRevisionSettings.student_id == student_id
    ).first()

    if not settings:
        settings = StudentRevisionSettings(
            student_id=student_id,
            max_daily_minutes=60
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)

    return settings


def sync_struggles_to_revision_schedule(db: Session, student_id: str):
    """
    Fetch weak/struggling topics from Struggle Predictor
    and synchronize them with the RevisionSchedule.
    """
    today = date.today()

    # 1. Fetch struggling topics from Struggle Predictor
    struggles = get_top_struggles(db, student_id, top_n=20)

    # If student has no recorded struggles yet, also check StudentMastery
    if not struggles:
        mastery_records = db.query(StudentMastery).filter(
            StudentMastery.student_id == student_id
        ).all()
        for record in mastery_records:
            struggles.append({
                "topic": record.topic,
                "subject": record.subject,
                "struggle_score": round((1.0 - record.mastery_score), 4),
                "syllabus_weight": 1.0
            })

    for item in struggles:
        topic_name = item["topic"]
        subject_name = item["subject"]
        struggle_score = float(item.get("struggle_score", 0.5))
        syllabus_weight = float(item.get("syllabus_weight", 1.0))

        # Check existing revision schedule entry
        existing = db.query(RevisionSchedule).filter(
            RevisionSchedule.student_id == student_id,
            RevisionSchedule.topic == topic_name
        ).first()

        estimated_mins = estimate_study_minutes(struggle_score, syllabus_weight)

        if not existing:
            priority = determine_priority(struggle_score, is_overdue=True)
            new_schedule = RevisionSchedule(
                student_id=student_id,
                subject=subject_name,
                topic=topic_name,
                struggle_score=struggle_score,
                priority=priority,
                repetition=0,
                ease_factor=2.5,
                interval_days=1,
                estimated_minutes=estimated_mins,
                scheduled_date=today,
                status="PENDING"
            )
            db.add(new_schedule)
        else:
            # Update existing topic struggle score & priority
            existing.struggle_score = struggle_score
            existing.subject = subject_name
            existing.estimated_minutes = estimated_mins

            is_overdue = (existing.scheduled_date <= today and existing.status == "PENDING")
            existing.priority = determine_priority(struggle_score, is_overdue)

            # If task was scheduled today or earlier and is due, ensure status is PENDING if not completed today
            if existing.scheduled_date <= today and existing.status != "COMPLETED":
                existing.status = "PENDING"

    db.commit()


def balance_workload(db: Session, student_id: str):
    """
    Workload Balancing Algorithm:
    Ensures total estimated study minutes per date does not exceed student's max_daily_minutes.
    Redistributes lower-priority / non-overdue tasks to future days.
    """
    settings = get_or_create_settings(db, student_id)
    max_daily_mins = settings.max_daily_minutes
    today = date.today()

    # Get all pending revision tasks for the student
    pending_tasks = db.query(RevisionSchedule).filter(
        RevisionSchedule.student_id == student_id,
        RevisionSchedule.status == "PENDING"
    ).order_by(RevisionSchedule.scheduled_date.asc(), RevisionSchedule.struggle_score.desc()).all()

    if not pending_tasks:
        return

    # Track daily workload minutes per date
    daily_workload = {}

    for task in pending_tasks:
        # Move overdue past dates to today for balancing
        curr_date = max(today, task.scheduled_date)

        # Spreading loop: find earliest date starting from curr_date that can fit task
        target_date = curr_date
        while True:
            current_mins = daily_workload.get(target_date, 0)
            if current_mins + task.estimated_minutes <= max_daily_mins or target_date > curr_date + timedelta(days=14):
                daily_workload[target_date] = current_mins + task.estimated_minutes
                task.scheduled_date = target_date
                break
            target_date += timedelta(days=1)

    db.commit()


def get_revision_plan(db: Session, student_id: str):
    """
    Sync struggles, balance workload, and return full revision plan.
    """
    sync_struggles_to_revision_schedule(db, student_id)
    balance_workload(db, student_id)

    settings = get_or_create_settings(db, student_id)
    today = date.today()

    tasks = db.query(RevisionSchedule).filter(
        RevisionSchedule.student_id == student_id
    ).order_by(RevisionSchedule.scheduled_date.asc(), RevisionSchedule.struggle_score.desc()).all()

    today_tasks = [t for t in tasks if t.scheduled_date == today and t.status == "PENDING"]
    completed_today = [t for t in tasks if t.scheduled_date == today and t.status == "COMPLETED"]
    upcoming_tasks = [t for t in tasks if t.scheduled_date > today]

    today_minutes = sum(t.estimated_minutes for t in today_tasks)

    # Format result tasks
    def format_task(t):
        return {
            "schedule_id": str(t.schedule_id),
            "student_id": str(t.student_id),
            "subject": t.subject,
            "topic": t.topic,
            "struggle_score": t.struggle_score,
            "priority": t.priority,
            "repetition": t.repetition,
            "ease_factor": t.ease_factor,
            "interval_days": t.interval_days,
            "estimated_minutes": t.estimated_minutes,
            "scheduled_date": t.scheduled_date.isoformat(),
            "status": t.status,
            "last_reviewed_at": t.last_reviewed_at.isoformat() if t.last_reviewed_at else None
        }

    return {
        "student_id": student_id,
        "max_daily_minutes": settings.max_daily_minutes,
        "today_minutes": today_minutes,
        "today_count": len(today_tasks),
        "completed_today_count": len(completed_today),
        "today_tasks": [format_task(t) for t in today_tasks],
        "completed_today": [format_task(t) for t in completed_today],
        "upcoming_tasks": [format_task(t) for t in upcoming_tasks[:10]],
        "all_tasks": [format_task(t) for t in tasks]
    }


def record_topic_review(db: Session, student_id: str, schedule_id: str, quality_score: int):
    """
    Execute SM-2 review score update for a topic task:
    1. Recalculate repetition, ease factor, interval
    2. Set next review date
    3. Update student's topic mastery score
    """
    schedule = db.query(RevisionSchedule).filter(
        RevisionSchedule.schedule_id == schedule_id,
        RevisionSchedule.student_id == student_id
    ).first()

    if not schedule:
        raise ValueError("Revision task not found.")

    new_rep, new_ef, new_interval = calculate_sm2(
        repetition=schedule.repetition,
        ease_factor=schedule.ease_factor,
        interval_days=schedule.interval_days,
        quality=quality_score
    )

    now_time = datetime.now(timezone.utc)
    today = date.today()

    schedule.repetition = new_rep
    schedule.ease_factor = new_ef
    schedule.interval_days = new_interval
    schedule.last_reviewed_at = now_time

    # Schedule next review date based on new interval
    schedule.scheduled_date = today + timedelta(days=new_interval)
    schedule.status = "COMPLETED"

    # Also update StudentMastery
    mastery = db.query(StudentMastery).filter(
        StudentMastery.student_id == student_id,
        StudentMastery.topic == schedule.topic
    ).first()

    if mastery:
        questions_added = 5
        correct_added = 5 if quality_score >= 3 else max(1, quality_score)

        mastery.total_questions = (mastery.total_questions or 0) + questions_added
        mastery.correct_answers = (mastery.correct_answers or 0) + correct_added
        mastery.mastery_score = round(mastery.correct_answers / mastery.total_questions, 4)

        # Log history
        history = StudentMasteryHistory(
            student_id=student_id,
            mastery_id=mastery.mastery_id,
            subject=mastery.subject,
            topic=mastery.topic,
            mastery_score=mastery.mastery_score,
            source_type="revision_sm2",
            source_id=str(schedule_id)
        )
        db.add(history)

    # Invalidate Redis cache if available
    try:
        from app.services.mastery_service import redis_client
        redis_client.delete(f"struggles:{student_id}")
    except Exception:
        pass

    db.commit()
    db.refresh(schedule)

    return schedule


def update_revision_settings(db: Session, student_id: str, max_daily_minutes: int):
    """
    Update student's daily workload capacity (in minutes) and rebalance.
    """
    settings = get_or_create_settings(db, student_id)
    settings.max_daily_minutes = max(15, min(240, int(max_daily_minutes)))
    db.commit()
    db.refresh(settings)

    balance_workload(db, student_id)
    return settings
