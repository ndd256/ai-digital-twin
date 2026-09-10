import json
import logging
from typing import Any, Dict, List

from app.services.llm_service import get_llm_service

logger = logging.getLogger(__name__)


class VivaService:
    """
    Service responsible for:
    - Generating viva questions
    - Evaluating student answers
    - Generating follow-up questions
    - Producing final viva summary
    """

    def __init__(self):
        self.llm = get_llm_service()

    # ---------------------------------------------------------
    # Generate opening / next question
    # ---------------------------------------------------------

    def generate_question(
        self,
        context: str,
        previous_question: str = "",
        previous_answer: str = "",
        question_number: int = 1,
    ) -> Dict[str, Any]:

        # Use existing test-question generator as a compatible
        # fallback because it already exists in the project.
        try:
            questions = self.llm.generate_test_questions(
                context,
                1,
            )

            if questions:
                question = questions[0]

                if isinstance(question, dict):
                    text = (
                        question.get("question")
                        or question.get("question_text")
                        or ""
                    )
                    topic = (
                        question.get("category")
                        or question.get("topic")
                        or "General"
                    )
                else:
                    text = str(question)
                    topic = "General"

                if text:
                    return {
                        "question": text,
                        "topic": topic,
                        "question_number": question_number,
                        "type": (
                            "follow_up"
                            if previous_answer
                            else "opening"
                        ),
                    }

        except Exception as exc:
            logger.exception(
                "Viva question generation failed: %s",
                exc,
            )

        # Safe fallback
        if previous_answer:
            return {
                "question": (
                    "Can you explain your previous answer "
                    "in more detail and give an example?"
                ),
                "topic": "General",
                "question_number": question_number,
                "type": "follow_up",
            }

        return {
            "question": (
                "Please explain the main concept from the "
                "selected study material."
            ),
            "topic": "General",
            "question_number": question_number,
            "type": "opening",
        }

    # ---------------------------------------------------------
    # Evaluate answer
    # ---------------------------------------------------------

    def evaluate_answer(
        self,
        context: str,
        question: str,
        answer: str,
        topic: str = "General",
    ) -> Dict[str, Any]:

        if not answer.strip():
            return {
                "score": 0,
                "max_score": 10,
                "is_correct": False,
                "feedback": "No answer was detected. Please try again.",
                "strengths": [],
                "areas_to_improve": [
                    "Provide an answer to the question."
                ],
            }

        answer_lower = answer.lower().strip()

        # -----------------------------------------------------
        # Try an existing LLM evaluation method if available.
        # -----------------------------------------------------

        evaluator = getattr(
            self.llm,
            "evaluate_viva_answer",
            None,
        )

        if callable(evaluator):
            try:
                result = evaluator(
                    context=context,
                    question=question,
                    answer=answer,
                    topic=topic,
                )

                if isinstance(result, dict):
                    return self._normalize_evaluation(result)

            except Exception as exc:
                logger.exception(
                    "LLM viva evaluation failed: %s",
                    exc,
                )

        # -----------------------------------------------------
        # Compatible fallback evaluation.
        # -----------------------------------------------------

        context_words = {
            word.strip(".,!?;:()[]{}").lower()
            for word in context.split()
            if len(word.strip(".,!?;:()[]{}")) >= 5
        }

        answer_words = {
            word.strip(".,!?;:()[]{}").lower()
            for word in answer_lower.split()
            if len(word.strip(".,!?;:()[]{}")) >= 5
        }

        overlap = len(context_words.intersection(answer_words))

        if overlap >= 8:
            score = 9
        elif overlap >= 5:
            score = 7
        elif overlap >= 2:
            score = 5
        else:
            score = 3

        return {
            "score": score,
            "max_score": 10,
            "is_correct": score >= 5,
            "feedback": self._fallback_feedback(score),
            "strengths": (
                ["Answer contains relevant concepts."]
                if score >= 5
                else []
            ),
            "areas_to_improve": (
                []
                if score >= 8
                else [
                    "Explain the concept more clearly.",
                    "Include important technical details.",
                ]
            ),
        }

    # ---------------------------------------------------------
    # Normalize LLM response
    # ---------------------------------------------------------

    def _normalize_evaluation(
        self,
        result: Dict[str, Any],
    ) -> Dict[str, Any]:

        try:
            score = float(
                result.get("score", 0)
            )
        except Exception:
            score = 0

        score = max(0, min(10, score))

        return {
            "score": score,
            "max_score": 10,
            "is_correct": bool(
                result.get(
                    "is_correct",
                    score >= 5,
                )
            ),
            "feedback": (
                result.get("feedback")
                or "Answer evaluated."
            ),
            "strengths": (
                result.get("strengths")
                if isinstance(
                    result.get("strengths"),
                    list,
                )
                else []
            ),
            "areas_to_improve": (
                result.get("areas_to_improve")
                if isinstance(
                    result.get("areas_to_improve"),
                    list,
                )
                else []
            ),
        }

    # ---------------------------------------------------------
    # Fallback feedback
    # ---------------------------------------------------------

    def _fallback_feedback(
        self,
        score: float,
    ) -> str:

        if score >= 8:
            return (
                "Good answer. You demonstrated strong "
                "understanding of the concept."
            )

        if score >= 5:
            return (
                "Your answer is partially correct. "
                "Add more explanation and technical details."
            )

        return (
            "The answer needs improvement. Review the "
            "study material and explain the concept more clearly."
        )

    # ---------------------------------------------------------
    # Final summary
    # ---------------------------------------------------------

    def generate_summary(
        self,
        exchanges: List[Dict[str, Any]],
    ) -> Dict[str, Any]:

        if not exchanges:
            return {
                "total_questions": 0,
                "average_score": 0,
                "performance_label": "No attempts",
                "strengths": [],
                "areas_to_improve": [],
            }

        scores = [
            float(item.get("evaluation", {}).get("score", 0))
            for item in exchanges
        ]

        average_score = (
            sum(scores) / len(scores)
            if scores
            else 0
        )

        if average_score >= 8:
            label = "Excellent"
        elif average_score >= 6:
            label = "Good"
        elif average_score >= 4:
            label = "Needs Improvement"
        else:
            label = "Weak"

        strengths = []
        improvements = []

        for exchange in exchanges:
            evaluation = exchange.get(
                "evaluation",
                {},
            )

            strengths.extend(
                evaluation.get(
                    "strengths",
                    [],
                )
            )

            improvements.extend(
                evaluation.get(
                    "areas_to_improve",
                    [],
                )
            )

        return {
            "total_questions": len(exchanges),
            "average_score": round(
                average_score,
                2,
            ),
            "performance_label": label,
            "strengths": list(
                dict.fromkeys(strengths)
            )[:5],
            "areas_to_improve": list(
                dict.fromkeys(improvements)
            )[:5],
        }


_viva_service = None


def get_viva_service() -> VivaService:
    global _viva_service

    if _viva_service is None:
        _viva_service = VivaService()

    return _viva_service
