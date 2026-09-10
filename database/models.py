import uuid

from sqlalchemy import (
    Column,
    String,
    Text,
    ForeignKey,
    ARRAY,
    DateTime,
    Date,
    Integer,
    Float,
    Index,
    func
)

from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector

from database.session import Base


class Student(Base):
    __tablename__ = "students"

    student_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    email = Column(
        String(255),
        unique=True,
        nullable=False
    )

    full_name = Column(
        String(255),
        nullable=False
    )

    password_hash = Column(
        String(255),
        nullable=True
    )

    board = Column(
        String(100),
        nullable=True
    )

    grade = Column(
        String(50),
        nullable=True
    )

    date_of_birth = Column(
        Date,
        nullable=True
    )

    guardian_email = Column(
        String(255),
        nullable=True
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    chunks = relationship(
        "KnowledgeChunk",
        back_populates="student",
        cascade="all, delete-orphan"
    )

    documents = relationship(
        "Document",
        back_populates="student",
        cascade="all, delete-orphan"
    )

    mastery_records = relationship(
        "StudentMastery",
        back_populates="student",
        cascade="all, delete-orphan"
    )

    tests = relationship(
        "Test",
        back_populates="student",
        cascade="all, delete-orphan"
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    # Student's uploaded knowledge chunks
    chunks = relationship(
        "KnowledgeChunk",
        back_populates="student",
        cascade="all, delete-orphan"
    )

    # Student's documents
    documents = relationship(
        "Document",
        back_populates="student",
        cascade="all, delete-orphan"
    )


    # Student's mastery records
    mastery_records = relationship(
        "StudentMastery",
        back_populates="student",
        cascade="all, delete-orphan"
    )

    # Student's tests
    tests = relationship(
        "Test",
        back_populates="student",
        cascade="all, delete-orphan"
    )


# ============================================================
# Knowledge Chunk Model
# ============================================================

class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"

    chunk_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    student_id = Column(
        UUID(as_uuid=True),
        ForeignKey(
            "students.student_id",
            ondelete="CASCADE"
        ),
        nullable=False
    )

    text_content = Column(
        Text,
        nullable=False
    )

    topic_tags = Column(
        ARRAY(String(100))
    )

    embedding = Column(
        Vector(1536)
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    document_id = Column(
        UUID(as_uuid=True),
        ForeignKey(
            "documents.document_id",
            ondelete="CASCADE"
        ),
        nullable=True
    )

    student = relationship(
        "Student",
        back_populates="chunks"
    )

    document = relationship(
        "Document",
        back_populates="chunks"
    )


class StudentMastery(Base):
    __tablename__ = "student_mastery"

    mastery_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    student_id = Column(
        UUID(as_uuid=True),
        ForeignKey(
            "students.student_id",
            ondelete="CASCADE"
        ),
        nullable=False
    )

    subject = Column(
        String(100),
        nullable=False
    )

    topic = Column(
        String(255),
        nullable=False
    )

    correct_answers = Column(
        Integer,
        default=0,
        nullable=False
    )

    total_questions = Column(
        Integer,
        default=0,
        nullable=False
    )

    mastery_score = Column(
        Float,
        default=0.0,
        nullable=False
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )

    student = relationship(
        "Student",
        back_populates="mastery_records"
    )


class MasterySnapshot(Base):
    __tablename__ = "mastery_snapshots"

    snapshot_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    student_id = Column(
        UUID(as_uuid=True),
        ForeignKey(
            "students.student_id",
            ondelete="CASCADE"
        ),
        nullable=False
    )

    subject = Column(
        String(100),
        nullable=False
    )

    topic = Column(
        String(255),
        nullable=False
    )

    correct_answers = Column(
        Integer,
        nullable=False
    )

    total_questions = Column(
        Integer,
        nullable=False
    )

    mastery_score = Column(
        Float,
        nullable=False
    )

    snapshot_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    student = relationship("Student")

    __table_args__ = (
        Index(
            "ix_mastery_snapshots_lookup",
            "student_id",
            "subject",
            "topic",
            "snapshot_at"
        ),
    )


class SyllabusWeight(Base):
    __tablename__ = "syllabus_weights"

    weight_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    subject = Column(
        String(100),
        nullable=False
    )

    topic = Column(
        String(255),
        nullable=False
    )

    # 0.0 - 1.0, how heavily this topic counts in the exam/syllabus
    weight = Column(
        Float,
        nullable=False,
        default=1.0
    )

    # Optional - matches Student.board / Student.grade for
    # future board/grade-specific weighting. Not used by the
    # Week 4 Struggle Algorithm, but safe to have now.
    board = Column(
        String(100),
        nullable=True
    )

    grade = Column(
        String(50),
        nullable=True
    )

    # Optional - lets a topic point to a parent topic later
    # (e.g. "Kinematics" under "Mechanics") without forcing any
    # tree-walking logic to be built right now.
    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey(
            "syllabus_weights.weight_id",
            ondelete="SET NULL"
        ),
        nullable=True
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    __table_args__ = (
        Index(
            "ix_syllabus_weights_subject_topic",
            "subject",
            "topic",
            unique=True
        ),
    )


class Test(Base):
    __tablename__ = "tests"

    test_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    student_id = Column(
        UUID(as_uuid=True),
        ForeignKey(
            "students.student_id",
            ondelete="CASCADE"
        ),
        nullable=False
    )

    title = Column(
        String(255),
        nullable=False
    )

    subject = Column(
        String(100),
        nullable=False
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    student = relationship(
        "Student",
        back_populates="tests"
    )

    questions = relationship(
        "TestQuestion",
        back_populates="test",
        cascade="all, delete-orphan"
    )


class TestQuestion(Base):
    __tablename__ = "test_questions"

    question_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    test_id = Column(
        UUID(as_uuid=True),
        ForeignKey(
            "tests.test_id",
            ondelete="CASCADE"
        ),
        nullable=False
    )

    topic = Column(
        String(255),
        nullable=False
    )

    question_text = Column(
        Text,
        nullable=False
    )

    correct_answer = Column(
        String(255),
        nullable=False
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    test = relationship(
        "Test",
        back_populates="questions"
    )


class Document(Base):
    __tablename__ = "documents"

    document_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    student_id = Column(
        UUID(as_uuid=True),
        ForeignKey(
            "students.student_id",
            ondelete="CASCADE"
        ),
        nullable=False
    )

    filename = Column(
        String(255),
        nullable=False
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    student = relationship(
        "Student",
        back_populates="documents"
    )

    chunks = relationship(
        "KnowledgeChunk",
        back_populates="document",
        cascade="all, delete-orphan"
    )

# ============================================================
# Student Mastery History Model
# ============================================================

class StudentMasteryHistory(Base):
    __tablename__ = "student_mastery_history"

    history_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    student_id = Column(
        UUID(as_uuid=True),
        ForeignKey("students.student_id", ondelete="CASCADE"),
        nullable=False
    )

    mastery_id = Column(
        UUID(as_uuid=True),
        ForeignKey("student_mastery.mastery_id", ondelete="CASCADE"),
        nullable=True
    )

    subject = Column(String(100), nullable=False)
    topic = Column(String(255), nullable=False)
    mastery_score = Column(Float, nullable=False)
    
    # What caused this update? (e.g. test_id or just 'manual')
    source_type = Column(String(50), nullable=True, default="test")
    source_id = Column(String(255), nullable=True)

    timestamp = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    student = relationship("Student")
    mastery_record = relationship("StudentMastery")

class VivaSession(Base):
    __tablename__ = "viva_sessions"

    session_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id = Column(UUID(as_uuid=True), ForeignKey("students.student_id", ondelete="CASCADE"), nullable=False)
    topic = Column(String(255), nullable=True)
    status = Column(String(50), default="active")
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    average_score = Column(Float, nullable=True)
    performance_label = Column(String(100), nullable=True)
    summary_feedback = Column(Text, nullable=True)

    student = relationship("Student")
    exchanges = relationship("VivaExchange", back_populates="session", cascade="all, delete-orphan")

class VivaExchange(Base):
    __tablename__ = "viva_exchanges"

    exchange_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("viva_sessions.session_id", ondelete="CASCADE"), nullable=False)
    question_number = Column(Integer, nullable=False)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=True)
    topic = Column(String(255), nullable=True)
    score = Column(Float, nullable=True)
    feedback = Column(Text, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("VivaSession", back_populates="exchanges")

