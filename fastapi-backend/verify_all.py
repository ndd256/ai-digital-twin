import sys
import uuid
import asyncio
from datetime import datetime
import json
import logging
import base64

from database.session import SessionLocal, engine
from database.models import Base, Student, Document, KnowledgeChunk, StudentMastery, Test, TestQuestion, VivaSession, VivaExchange

from app.services.llm_service import get_llm_service
from app.services.viva_service import get_viva_service
from app.services.stt_service import get_stt_service
from app.services.tts_service import get_tts_service
from app.api.routes import router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('verify')

def run_checks():
    db = SessionLocal()
    try:
        logger.info("=== Week 1: Database and Setup ===")
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created successfully.")
        
        student_id = uuid.uuid4()
        student = Student(student_id=student_id, email=f"test_{student_id}@example.com", full_name="Test Student", password_hash="hash")
        db.add(student)
        db.commit()
        logger.info("Created test student.")

        logger.info("=== Week 2: File Ingestion ===")
        doc_id = uuid.uuid4()
        doc = Document(document_id=doc_id, student_id=student_id, filename="test.pdf")
        db.add(doc)
        db.commit()
        
        # Insert some chunks for RAG
        chunk1 = KnowledgeChunk(
            student_id=student_id,
            document_id=doc_id,
            text_content="Artificial Intelligence (AI) is the simulation of human intelligence in machines.",
            topic_tags=["AI", "Intro"]
        )
        db.add(chunk1)
        db.commit()
        logger.info("Created document and chunks for RAG.")

        logger.info("=== Week 3 & 4: Student Profile & Struggle Predictor ===")
        mastery = StudentMastery(student_id=student_id, subject="Computer Science", topic="AI", correct_answers=1, total_questions=5, mastery_score=2.0)
        db.add(mastery)
        db.commit()
        logger.info("Created student mastery record.")
        
        logger.info("=== Week 5: Grounded RAG Quiz Engine ===")
        llm = get_llm_service()
        if not llm.llm:
            logger.warning("LLM not configured (missing API keys). Skipping real LLM call.")
        else:
            logger.info("Testing generate_test_questions...")
            q = llm.generate_test_questions(chunk1.text_content, 1)
            logger.info(f"Generated Question: {q}")

        logger.info("=== Week 6: Viva Simulator (LLM + STT + TTS) ===")
        viva = get_viva_service()
        if llm.llm:
            logger.info("Testing Viva Evaluator...")
            eval_result = viva.evaluate_answer(
                context=chunk1.text_content,
                question="What is Artificial Intelligence?",
                answer="It is the simulation of human intelligence by machines.",
                topic="AI"
            )
            logger.info(f"Evaluation Result: {eval_result}")
            
            logger.info("Testing Viva Follow Up...")
            follow_up = llm.generate_viva_follow_up(
                context=chunk1.text_content,
                previous_question="What is Artificial Intelligence?",
                previous_answer="It is the simulation of human intelligence by machines."
            )
            logger.info(f"Follow up Result: {follow_up}")
        
        stt = get_stt_service()
        tts = get_tts_service()
        logger.info(f"STT Configured: {stt.is_configured}")
        logger.info(f"TTS Configured: {tts.is_configured}")
        
        logger.info("All internal verifications completed successfully.")

    except Exception as e:
        logger.error(f"Error during checks: {e}")
    finally:
        db.close()

if __name__ == '__main__':
    run_checks()