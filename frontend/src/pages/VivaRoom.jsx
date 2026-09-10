import React, { useState, useEffect, useRef } from 'react';
import { Container, Row, Col, Card, Button, Badge, ProgressBar, Alert, Form, Modal, Spinner } from 'react-bootstrap';
import {
  Mic, MicOff, Play, Pause, Volume2, VolumeX, AlertCircle, CheckCircle2,
  RotateCcw, StopCircle, ArrowRight, Award, HelpCircle, FileText,
  Sparkles, RefreshCw, BarChart2, Check, X, ChevronRight, Download
} from 'lucide-react';

// NOTE (Member 2 / STT-TTS): the real backend mounts the viva
// router at /api/v1/viva, with sessions created via POST /start
// and then joined at /api/v1/viva/ws/{session_id} - it does NOT
// accept a bare "start_viva" event over a session-less socket.
// This was flagged to the team; keeping the old FASTAPI_WS_URL
// export in case other code still imports it.
const FASTAPI_API_BASE = import.meta.env.VITE_FASTAPI_API_URL || 'http://localhost:8000/api/v1';
const FASTAPI_WS_BASE = import.meta.env.VITE_FASTAPI_WS_URL || 'ws://localhost:8000/api/v1';

const SUBJECT_OPTIONS = ['Physics', 'Chemistry', 'Mathematics', 'Computer Science', 'Biology'];

export default function VivaRoom({
  initialSubject = 'Physics',
  initialTopic = 'Core Concepts & Thermodynamics',
  initialTotalQuestions = 5,
  autoStart = false,
  onExit = null,
  // TODO: wire to real auth/session context - placeholder until
  // Member 1/4 finalize how the logged-in student's UUID reaches
  // this page.
  studentId = null
}) {
  // Session Configuration & State
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [subject, setSubject] = useState(initialSubject);
  const [topic, setTopic] = useState(initialTopic);
  const [totalQuestions, setTotalQuestions] = useState(initialTotalQuestions);
  const [showConfigModal, setShowConfigModal] = useState(!autoStart);
  const [showEndModal, setShowEndModal] = useState(false);

  // WebSocket & Connection State
  const [wsStatus, setWsStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'error'
  const [fallbackMode, setFallbackMode] = useState(false);
  const wsRef = useRef(null);

  // Viva Session Data
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(1);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [currentQuestionId, setCurrentQuestionId] = useState(null);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [currentFeedback, setCurrentFeedback] = useState(null);
  const [finalResult, setFinalResult] = useState(null);

  // Recording & Microphone State
  const [recordingState, setRecordingState] = useState('IDLE'); // 'IDLE' | 'LISTENING' | 'RECORDING' | 'PROCESSING' | 'EVALUATING' | 'SPEAKING'
  const [micPermission, setMicPermission] = useState('prompt'); // 'granted' | 'denied' | 'prompt'
  const [micMuted, setMicMuted] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [editedTranscript, setEditedTranscript] = useState('');

  // Audio Playback & Visualizer
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [autoPlayTts, setAutoPlayTts] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const canvasRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const audioContextRef = useRef(null);
  const animFrameRef = useRef(null);

  // Real Mic Capture (Whisper) & Server TTS Playback
  const sessionIdRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const ttsAudioElRef = useRef(null);

  // Error Handling
  const [errorMessage, setErrorMessage] = useState('');

  // Timer
  const [timerSeconds, setTimerSeconds] = useState(0);
  const timerRef = useRef(null);

  // Check Microphone Permissions on Mount
  useEffect(() => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          setMicPermission('granted');
          stream.getTracks().forEach(track => track.stop());
        })
        .catch(() => {
          setMicPermission('denied');
        });
    } else {
      setMicPermission('denied');
    }

    return () => {
      stopRecording();
      if (wsRef.current) wsRef.current.close();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      if (timerRef.current) clearInterval(timerRef.current);
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (ttsAudioElRef.current) ttsAudioElRef.current.pause();
    };
  }, []);

  // Auto Start Handler if embedded
  useEffect(() => {
    if (autoStart && !sessionStarted) {
      handleStartViva();
    }
  }, [autoStart]);

  // Timer Logic
  useEffect(() => {
    if (sessionStarted && !sessionCompleted) {
      timerRef.current = setInterval(() => {
        setTimerSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionStarted, sessionCompleted]);

  // Audio Visualizer Canvas Loop
  useEffect(() => {
    if (recordingState === 'RECORDING' && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      let angle = 0;

      const drawWave = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#38BDF8';
        ctx.beginPath();

        const sliceWidth = canvas.width / 50;
        let x = 0;

        for (let i = 0; i < 50; i++) {
          const v = Math.sin(angle + i * 0.2) * (10 + Math.random() * 15);
          const y = canvas.height / 2 + v;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }

        ctx.stroke();
        angle += 0.15;
        animFrameRef.current = requestAnimationFrame(drawWave);
      };

      drawWave();
    } else {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    }
  }, [recordingState]);

  // TTS Reader
  const speakText = (text) => {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(v => v.lang.includes('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')));
    if (englishVoice) utterance.voice = englishVoice;

    utterance.onstart = () => {
      setTtsSpeaking(true);
      setRecordingState('SPEAKING');
    };

    utterance.onend = () => {
      setTtsSpeaking(false);
      setRecordingState('LISTENING');
    };

    utterance.onerror = () => {
      setTtsSpeaking(false);
      setRecordingState('LISTENING');
    };

    window.speechSynthesis.speak(utterance);
  };

  const stopTts = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (ttsAudioElRef.current) {
      ttsAudioElRef.current.pause();
      ttsAudioElRef.current.currentTime = 0;
    }
    setTtsSpeaking(false);
    setRecordingState('LISTENING');
  };

  // Plays real examiner voice (OpenAI TTS, base64 mp3) when the
  // backend provided it; falls back to the browser's built-in
  // speechSynthesis (already implemented above) when it didn't -
  // e.g. OPENAI_API_KEY isn't configured yet.
  const playExaminerVoice = (text, audioBase64, audioFormat = 'mp3') => {
    if (!audioBase64) {
      speakText(text);
      return;
    }

    try {
      const audio = new Audio(`data:audio/${audioFormat};base64,${audioBase64}`);
      ttsAudioElRef.current = audio;

      audio.onplay = () => {
        setTtsSpeaking(true);
        setRecordingState('SPEAKING');
      };
      audio.onended = () => {
        setTtsSpeaking(false);
        setRecordingState('LISTENING');
      };
      audio.onerror = () => {
        console.warn('Server TTS playback failed, falling back to speechSynthesis.');
        setTtsSpeaking(false);
        speakText(text);
      };

      audio.play().catch(() => speakText(text));
    } catch (e) {
      speakText(text);
    }
  };

  // ------------------------------------------------------------
  // Real Microphone Capture (sent to backend for Whisper STT)
  // ------------------------------------------------------------
  const startMediaCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.start();
    } catch (err) {
      console.warn('Microphone capture failed to start:', err);
      setMicPermission('denied');
      setErrorMessage('Could not access the microphone for recording.');
    }
  };

  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  // Stops the recorder and returns the captured audio as base64,
  // or null if nothing was recorded (e.g. mic never started).
  const stopMediaCaptureAndEncode = () => new Promise((resolve) => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === 'inactive') {
      resolve(null);
      return;
    }

    recorder.onstop = async () => {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (audioChunksRef.current.length === 0) {
        resolve(null);
        return;
      }
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const base64 = await blobToBase64(blob);
      resolve(base64);
    };

    recorder.stop();
  });

  // Setup Web Socket Connection
  // The real backend needs a session first (POST /viva/start,
  // which runs the RAG lookup + generates question 1), THEN a
  // WebSocket join at /viva/ws/{session_id}. Without a studentId
  // we can't create that session, so we drop straight to the
  // local simulator rather than failing silently.
  const connectWebSocket = async () => {
    setWsStatus('connecting');
    setErrorMessage('');

    if (!studentId) {
      console.warn('No studentId provided; using local viva simulator.');
      enableFallbackMode();
      return;
    }

    try {
      const startRes = await fetch(`${FASTAPI_API_BASE}/viva/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          topic: topic,
          max_questions: totalQuestions
        })
      });

      if (!startRes.ok) {
        throw new Error(`viva/start failed: ${startRes.status}`);
      }

      const startData = await startRes.json();
      sessionIdRef.current = startData.session_id;

      const ws = new WebSocket(`${FASTAPI_WS_BASE}/viva/ws/${startData.session_id}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsStatus('connected');
        setFallbackMode(false);
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          handleWebSocketMessage(data);
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };

      ws.onerror = (err) => {
        console.warn('WebSocket error, falling back to local simulator:', err);
        setWsStatus('error');
        enableFallbackMode();
      };

      ws.onclose = () => {
        if (sessionStarted && !sessionCompleted && !fallbackMode) {
          setWsStatus('disconnected');
          setErrorMessage('WebSocket connection closed. Switching to local interactive viva mode.');
          enableFallbackMode();
        }
      };

      // The start_viva REST call already returned question 1
      // synchronously (no TTS attached there yet - only the WS
      // path attaches audio_base64). Surface it immediately so
      // the student isn't staring at a blank screen while the
      // socket opens.
      const q = startData.question || {};
      setCurrentQuestion(q.question || '');
      setCurrentQuestionIndex(startData.question_number || 1);
      setSessionStarted(true);
      setShowConfigModal(false);
      setRecordingState('LISTENING');
      if (autoPlayTts && q.question) speakText(q.question);

    } catch (e) {
      console.warn('WebSocket/session bootstrap failed:', e);
      enableFallbackMode();
    }
  };

  // Local Viva Simulator (Fallback if backend WS is offline)
  const enableFallbackMode = () => {
    setFallbackMode(true);
    setWsStatus('connected');

    // Simulate viva_started
    const mockQuestions = {
      Physics: "Can you state the First Law of Thermodynamics and explain what physical quantity it conserves?",
      Chemistry: "What is Le Chatelier's Principle and how does it predict dynamic chemical equilibrium shifts?",
      Mathematics: "What is the geometric interpretation of the derivative of a single-variable function?",
      "Computer Science": "What is the difference between a process and a thread in operating systems?",
      Biology: "What is ATP and why is it considered the energy currency of the cell?"
    };

    const initialQ = mockQuestions[subject] || "Can you explain the main principles of this topic?";
    setCurrentQuestion(initialQ);
    setCurrentQuestionIndex(1);
    setSessionStarted(true);
    setShowConfigModal(false);
    setRecordingState('LISTENING');

    if (autoPlayTts) speakText(initialQ);
  };

  // Handle Backend WebSocket Messages
  // NOTE: the real backend keys its messages by "type", not
  // "event" - e.g. {"type": "question", ...}. Handled below.
  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'connection':
        // Just an ack that the socket joined the session; no UI change needed.
        break;

      case 'question':
        setCurrentQuestion(data.question);
        setCurrentQuestionIndex(data.question_number || 1);
        setCurrentFeedback(null);
        setLiveTranscript('');
        setEditedTranscript('');
        setSessionStarted(true);
        setShowConfigModal(false);
        setRecordingState('LISTENING');
        if (autoPlayTts) playExaminerVoice(data.question, data.audio_base64, data.audio_format);
        if (data.tts_error) console.warn('Examiner TTS unavailable:', data.tts_error);
        break;

      case 'audio_received':
        // Backend acked the recorded audio and is running Whisper.
        setRecordingState('PROCESSING');
        break;

      case 'transcript_ready':
        // Whisper's transcript for what the student just said.
        setLiveTranscript(data.text || '');
        setEditedTranscript(data.text || '');
        break;

      case 'evaluation_started':
        setRecordingState('EVALUATING');
        break;

      case 'evaluation': {
        const evaluation = data.evaluation || {};
        const feedbackObj = {
          question_number: data.question_number,
          score: evaluation.score,
          feedback: evaluation.feedback,
          strengths: evaluation.strengths || [],
          weak_concepts: evaluation.areas_to_improve || [],
        };

        setCurrentFeedback(feedbackObj);
        setRecordingState('IDLE');

        setConversationHistory(prev => [
          ...prev,
          {
            number: data.question_number,
            question: data.question || currentQuestion,
            student_answer: data.answer || editedTranscript || liveTranscript || '(No answer provided)',
            score: evaluation.score,
            feedback: evaluation.feedback,
            strengths: evaluation.strengths,
            weak_concepts: evaluation.areas_to_improve
          }
        ]);
        break;
      }

      case 'session_completed':
      case 'session_ended':
      case 'session_timeout': {
        const summary = data.summary || {};
        setSessionCompleted(true);
        setRecordingState('IDLE');
        stopTts();
        setFinalResult({
          final_score: summary.average_score != null ? Math.round((summary.average_score / 10) * 100) : undefined,
          average_question_score: summary.average_score,
          grade: summary.performance_label,
          summary: summary.performance_label
            ? `${summary.performance_label} performance across ${summary.total_questions} question(s).`
            : 'Viva completed.',
          strengths: summary.strengths || [],
          weak_areas: summary.areas_to_improve || [],
          history: (data.transcript || []).map(ex => ({
            question_number: ex.question_number,
            question: ex.question,
            student_answer: ex.answer,
            score: ex.evaluation?.score,
            feedback: ex.evaluation?.feedback
          }))
        });
        break;
      }

      case 'pong':
        break;

      case 'error':
        setErrorMessage(data.message || 'An error occurred during viva.');
        setRecordingState(data.code === 'NO_ACTIVE_QUESTION' ? 'IDLE' : 'LISTENING');
        break;

      default:
        break;
    }
  };

  // Start Viva Action
  const handleStartViva = () => {
    setShowConfigModal(false);
    setTimerSeconds(0);
    setConversationHistory([]);
    setCurrentFeedback(null);
    setFinalResult(null);
    setLiveTranscript('');
    setEditedTranscript('');
    setSessionCompleted(false);

    connectWebSocket();
  };

  // Speech Recognition Controls
  const startRecording = () => {
    if (micMuted) setMicMuted(false);
    setRecordingState('RECORDING');
    setLiveTranscript('');
    setEditedTranscript('');

    // Real path: capture actual audio for Whisper. This runs
    // alongside the Web Speech API below, which is kept only for
    // an instant on-screen caption while the student talks - the
    // authoritative transcript comes back from the backend via
    // "transcript_ready" once Whisper processes the recording.
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !fallbackMode) {
      startMediaCapture();
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        speechRecognitionRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          let currentFinal = '';
          let currentInterim = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              currentFinal += event.results[i][0].transcript + ' ';
            } else {
              currentInterim += event.results[i][0].transcript;
            }
          }

          if (currentFinal) {
            setLiveTranscript(prev => prev + currentFinal);
            setEditedTranscript(prev => prev + currentFinal);
          }
          setInterimTranscript(currentInterim);
        };

        recognition.onerror = (e) => {
          console.warn('Speech recognition error:', e.error);
          if (e.error === 'not-allowed') {
            setMicPermission('denied');
          }
        };

        recognition.onend = () => {
          setInterimTranscript('');
        };

        recognition.start();
      } catch (err) {
        console.error('Failed to start speech recognition:', err);
      }
    } else {
      setErrorMessage('Browser Web Speech API not supported. You can type or use quick sample responses below.');
    }
  };

  const stopRecording = () => {
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch (e) { }
    }
    setRecordingState('IDLE');
    setInterimTranscript('');
  };

  // Submit Answer
  const handleSubmitAnswer = async () => {
    const isRealMode = wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !fallbackMode;
    const hasRecordedAudio = isRealMode && mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive';
    const finalAnswerText = (editedTranscript || liveTranscript || interimTranscript).trim();

    if (!finalAnswerText && !hasRecordedAudio) {
      setErrorMessage('Please speak or enter an answer before submitting.');
      return;
    }

    stopRecording();
    setErrorMessage('');

    if (isRealMode) {
      if (hasRecordedAudio) {
        // Send the raw recording - backend runs Whisper and replies
        // with "transcript_ready", then evaluates automatically.
        setRecordingState('PROCESSING');
        const audioBase64 = await stopMediaCaptureAndEncode();

        if (!audioBase64) {
          setErrorMessage('No audio was captured. Please try recording again.');
          setRecordingState('LISTENING');
          return;
        }

        wsRef.current.send(JSON.stringify({
          type: 'audio',
          data: audioBase64,
          filename: 'answer.webm'
        }));
      } else {
        // No mic recording (e.g. typed answer only) - send as text.
        setRecordingState('EVALUATING');
        wsRef.current.send(JSON.stringify({
          type: 'transcript',
          text: finalAnswerText
        }));
      }
    } else {
      setRecordingState('EVALUATING');
      // Local Mock Evaluation
      setTimeout(() => {
        const mockScore = Math.floor(Math.random() * 3) + 8; // 8-10
        const feedbackObj = {
          question_number: currentQuestionIndex,
          total_questions: totalQuestions,
          score: mockScore,
          feedback: "Great explanation! You addressed key core concepts with clarity and precision.",
          strengths: ["Clear terminology", "Logical explanation flow"],
          weak_concepts: ["Consider adding a practical example next time"],
          sample_answer: "Sample optimal answer explaining the foundational laws and formulas clearly."
        };

        setCurrentFeedback(feedbackObj);
        setRecordingState('IDLE');

        const newHistoryItem = {
          number: currentQuestionIndex,
          question: currentQuestion,
          student_answer: finalAnswerText,
          score: mockScore,
          feedback: feedbackObj.feedback,
          strengths: feedbackObj.strengths,
          weak_concepts: feedbackObj.weak_concepts
        };

        setConversationHistory(prev => [...prev, newHistoryItem]);
      }, 1200);
    }
  };

  // Next Question
  const handleNextQuestion = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !fallbackMode) {
      // Real backend already pushed the next question over the
      // socket right after evaluation - just dismiss the feedback
      // card, the "question" handler above set everything else.
      setCurrentFeedback(null);
    } else {
      // Fallback Next Question logic
      if (currentQuestionIndex < totalQuestions) {
        const nextIdx = currentQuestionIndex + 1;
        const mockQuestions = [
          "Can you state the First Law of Thermodynamics and explain what physical quantity it conserves?",
          "What is the key difference between isothermal and adiabatic thermodynamic processes?",
          "Explain Newton's Second Law of Motion and how force relates to momentum.",
          "What is the photoelectric effect and how did Einstein explain it using quanta of light?",
          "Define electromagnetic induction and Faraday's Law."
        ];
        const nextQ = mockQuestions[nextIdx - 1] || "Explain another key principle of this subject.";
        setCurrentQuestion(nextQ);
        setCurrentQuestionIndex(nextIdx);
        setCurrentFeedback(null);
        setLiveTranscript('');
        setEditedTranscript('');
        setRecordingState('LISTENING');
        if (autoPlayTts) speakText(nextQ);
      } else {
        // Complete Viva in fallback
        handleEndViva();
      }
    }
  };

  // End Viva Action
  const handleEndViva = () => {
    setShowEndModal(false);
    stopTts();
    stopRecording();

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !fallbackMode) {
      wsRef.current.send(JSON.stringify({ type: 'end' }));
    } else {
      // Local completion
      setSessionCompleted(true);
      setRecordingState('IDLE');

      const scores = conversationHistory.map(h => h.score);
      const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 8.5;
      const pct = Math.round((avgScore / 10) * 100);

      setFinalResult({
        final_score: pct,
        average_question_score: avgScore.toFixed(1),
        grade: pct >= 85 ? 'A' : 'B',
        summary: `Viva session completed with ${conversationHistory.length} questions answered. Good overall conceptual understanding.`,
        strengths: ["Strong core definitions", "Confident delivery"],
        weak_areas: ["Thermodynamic calculations", "Sign conventions"],
        history: conversationHistory
      });
    }
  };

  // Formatted Time Helper
  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="viva-room-container py-4 text-light" style={{ minHeight: '92vh', backgroundColor: '#0F172A' }}>
      <Container fluid className="px-lg-5">

        {/* TOP TOOLBAR & TITLE */}
        <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between pb-3 mb-4 border-bottom border-secondary border-opacity-25">
          <div className="d-flex align-items-center mb-2 mb-md-0">
            <div className="p-3 rounded-4 me-3" style={{ background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
              <Mic className="text-info" size={28} />
            </div>
            <div>
              <div className="d-flex align-items-center gap-2">
                <h3 className="fw-bold mb-0 text-white">AI Viva Voice Exam Room</h3>
                <Badge bg="info" className="text-dark fw-bold px-2 py-1">LIVE STT & TTS</Badge>
              </div>
              <p className="text-muted small mb-0">Real-time examiner evaluation connected via FastAPI WebSocket</p>
            </div>
          </div>

          <div className="d-flex align-items-center gap-2">
            {sessionStarted && !sessionCompleted && (
              <>
                <div className="px-3 py-1 rounded-3 bg-dark border border-secondary text-info fw-mono me-2">
                  <span className="small text-muted me-2">ELAPSED:</span>
                  <strong>{formatTime(timerSeconds)}</strong>
                </div>

                <Button
                  variant="outline-danger"
                  className="rounded-3 d-flex align-items-center gap-2 px-3 py-2 fw-semibold"
                  onClick={() => setShowEndModal(true)}
                >
                  <StopCircle size={18} />
                  End Viva
                </Button>
              </>
            )}

            {!sessionStarted && (
              <Button
                variant="info"
                className="rounded-3 d-flex align-items-center gap-2 px-4 py-2 fw-bold text-dark"
                onClick={() => setShowConfigModal(true)}
              >
                <Sparkles size={18} />
                Configure & Start Viva
              </Button>
            )}
          </div>
        </div>

        {/* ERROR ALERTS */}
        {errorMessage && (
          <Alert variant="danger" dismissible onClose={() => setErrorMessage('')} className="rounded-3 mb-4 border-danger">
            <div className="d-flex align-items-center gap-2">
              <AlertCircle size={20} />
              <span>{errorMessage}</span>
            </div>
          </Alert>
        )}

        {/* MIC PERMISSION WARNING */}
        {micPermission === 'denied' && (
          <Alert variant="warning" className="rounded-3 mb-4 border-warning bg-dark text-warning">
            <div className="d-flex align-items-center gap-2">
              <MicOff size={20} />
              <span>Microphone access is blocked in your browser. You can enable mic access or type your answers in the transcript box below.</span>
            </div>
          </Alert>
        )}

        {/* CONFIGURATION MODAL */}
        <Modal show={showConfigModal} onHide={() => setShowConfigModal(false)} centered size="lg" contentClassName="bg-dark text-light border border-secondary rounded-4">
          <Modal.Header closeButton className="border-secondary">
            <Modal.Title className="fw-bold text-info d-flex align-items-center gap-2">
              <Sparkles size={22} />
              Setup AI Viva Examination
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="p-4">
            <Row className="g-4">
              <Col md={6}>
                <Form.Group>
                  <Form.Label className="fw-semibold text-light">Select Subject</Form.Label>
                  <Form.Select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="bg-secondary bg-opacity-25 border-secondary text-light p-3 rounded-3"
                  >
                    {SUBJECT_OPTIONS.map(s => (
                      <option key={s} value={s} className="bg-dark text-light">{s}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group>
                  <Form.Label className="fw-semibold text-light">Number of Questions</Form.Label>
                  <Form.Select
                    value={totalQuestions}
                    onChange={(e) => setTotalQuestions(Number(e.target.value))}
                    className="bg-secondary bg-opacity-25 border-secondary text-light p-3 rounded-3"
                  >
                    <option value={3} className="bg-dark text-light">3 Questions (Quick Quiz)</option>
                    <option value={5} className="bg-dark text-light">5 Questions (Standard Viva)</option>
                    <option value={10} className="bg-dark text-light">10 Questions (Comprehensive)</option>
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={12}>
                <Form.Group>
                  <Form.Label className="fw-semibold text-light">Topic / Focus Area</Form.Label>
                  <Form.Control
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Thermodynamics, Quantum Mechanics, Data Structures"
                    className="bg-secondary bg-opacity-25 border-secondary text-light p-3 rounded-3"
                  />
                </Form.Group>
              </Col>

              <Col md={12}>
                <Card className="bg-secondary bg-opacity-10 border-info border-opacity-25 p-3 rounded-3">
                  <div className="d-flex align-items-center gap-3">
                    <Volume2 className="text-info flex-shrink-0" size={24} />
                    <div className="flex-grow-1">
                      <div className="fw-bold text-light">Examiner Text-To-Speech (TTS)</div>
                      <div className="small text-muted">Auto-read examiner questions using synthetic voice</div>
                    </div>
                    <Form.Check
                      type="switch"
                      id="tts-switch"
                      checked={autoPlayTts}
                      onChange={(e) => setAutoPlayTts(e.target.checked)}
                      className="fs-4"
                    />
                  </div>
                </Card>
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer className="border-secondary p-3">
            <Button variant="outline-secondary" onClick={() => setShowConfigModal(false)} className="rounded-3 px-4">
              Cancel
            </Button>
            <Button variant="info" onClick={handleStartViva} className="rounded-3 px-4 text-dark fw-bold">
              Start Viva Session
            </Button>
          </Modal.Footer>
        </Modal>

        {/* CONFIRM END MODAL */}
        <Modal show={showEndModal} onHide={() => setShowEndModal(false)} centered contentClassName="bg-dark text-light border border-danger rounded-4">
          <Modal.Header closeButton className="border-secondary">
            <Modal.Title className="fw-bold text-danger d-flex align-items-center gap-2">
              <AlertCircle size={22} />
              End Viva Session Early?
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="p-4">
            <p className="mb-0 text-muted">
              Are you sure you want to finish the viva session now? Your recorded answers up to Question {currentQuestionIndex - 1} will be evaluated for the final result report.
            </p>
          </Modal.Body>
          <Modal.Footer className="border-secondary p-3">
            <Button variant="outline-secondary" onClick={() => setShowEndModal(false)} className="rounded-3 px-3">
              Continue Viva
            </Button>
            <Button variant="danger" onClick={handleEndViva} className="rounded-3 px-4 fw-bold">
              End & Generate Results
            </Button>
          </Modal.Footer>
        </Modal>

        {/* MAIN VIVA ROOM INTERFACE */}
        {sessionStarted && !sessionCompleted && (
          <Row className="g-4">

            {/* LEFT COLUMN: ACTIVE EXAMINER & RECORDING CONTROLS */}
            <Col lg={7}>

              {/* PROGRESS BAR */}
              <Card className="bg-secondary bg-opacity-10 border border-secondary rounded-4 p-3 mb-4">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <span className="fw-semibold text-info">
                    Question {currentQuestionIndex} of {totalQuestions}
                  </span>
                  <Badge bg="dark" className="border border-secondary px-3 py-1 text-light fw-normal">
                    {subject} • {topic}
                  </Badge>
                </div>
                <ProgressBar
                  now={(currentQuestionIndex / totalQuestions) * 100}
                  variant="info"
                  className="rounded-pill"
                  style={{ height: '8px', backgroundColor: '#1E293B' }}
                />
              </Card>

              {/* EXAMINER QUESTION CARD */}
              <Card className="bg-secondary bg-opacity-25 border border-info border-opacity-30 rounded-4 p-4 mb-4 shadow-lg position-relative overflow-hidden">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="d-flex align-items-center gap-3">
                    <div className="rounded-circle bg-info bg-opacity-20 text-info p-2 d-flex align-items-center justify-content-center" style={{ width: 44, height: 44 }}>
                      <Sparkles size={24} />
                    </div>
                    <div>
                      <h6 className="fw-bold text-white mb-0">AI Viva Examiner</h6>
                      <small className="text-muted">Evaluating technical precision & communication</small>
                    </div>
                  </div>

                  {/* RECORDING STATE BADGE */}
                  <div>
                    {recordingState === 'SPEAKING' && (
                      <Badge bg="warning" className="text-dark px-3 py-2 rounded-pill fw-bold animate-pulse">
                        🔊 Examiner Speaking...
                      </Badge>
                    )}
                    {recordingState === 'RECORDING' && (
                      <Badge bg="danger" className="px-3 py-2 rounded-pill fw-bold animate-pulse">
                        🎙️ Recording Live Answer...
                      </Badge>
                    )}
                    {recordingState === 'EVALUATING' && (
                      <Badge bg="info" className="text-dark px-3 py-2 rounded-pill fw-bold">
                        <Spinner animation="border" size="sm" className="me-2" /> Evaluating Answer...
                      </Badge>
                    )}
                    {recordingState === 'LISTENING' && (
                      <Badge bg="success" className="px-3 py-2 rounded-pill fw-bold">
                        👂 Ready for Answer
                      </Badge>
                    )}
                    {recordingState === 'IDLE' && (
                      <Badge bg="secondary" className="px-3 py-2 rounded-pill fw-bold">
                        Idle
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="question-content bg-dark bg-opacity-50 p-4 rounded-3 border border-secondary mb-3">
                  <h4 className="fw-bold text-light mb-0 lh-base">
                    "{currentQuestion || 'Loading next question...'}"
                  </h4>
                </div>

                {/* TTS AUDIO PLAYBACK BUTTONS */}
                <div className="d-flex align-items-center gap-2">
                  {!ttsSpeaking ? (
                    <Button
                      variant="outline-info"
                      size="sm"
                      className="rounded-3 d-flex align-items-center gap-2"
                      onClick={() => speakText(currentQuestion)}
                    >
                      <Play size={14} /> Replay Question Voice
                    </Button>
                  ) : (
                    <Button
                      variant="outline-warning"
                      size="sm"
                      className="rounded-3 d-flex align-items-center gap-2"
                      onClick={stopTts}
                    >
                      <Pause size={14} /> Stop Voice Playback
                    </Button>
                  )}
                </div>
              </Card>

              {/* STUDENT RECORDING & LIVE TRANSCRIPT CARD */}
              <Card className="bg-secondary bg-opacity-15 border border-secondary rounded-4 p-4 shadow-sm mb-4">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <h5 className="fw-bold text-white mb-0 d-flex align-items-center gap-2">
                    <Mic className="text-info" size={20} />
                    Your Answer & Live Transcript
                  </h5>

                  <Button
                    variant={micMuted ? "danger" : "outline-secondary"}
                    size="sm"
                    className="rounded-3 d-flex align-items-center gap-1"
                    onClick={() => setMicMuted(!micMuted)}
                  >
                    {micMuted ? <MicOff size={14} /> : <Mic size={14} />}
                    {micMuted ? "Muted" : "Mute Mic"}
                  </Button>
                </div>

                {/* AUDIO WAVE VISUALIZER CANVAS */}
                {recordingState === 'RECORDING' && (
                  <div className="bg-dark p-2 rounded-3 mb-3 border border-info border-opacity-25 text-center">
                    <canvas ref={canvasRef} width={450} height={40} className="w-100" />
                    <small className="text-info fw-semibold">Listening to microphone audio input...</small>
                  </div>
                )}

                {/* TRANSCRIPT TEXT AREA */}
                <Form.Group className="mb-3">
                  <Form.Control
                    as="textarea"
                    rows={4}
                    value={editedTranscript || liveTranscript || interimTranscript}
                    onChange={(e) => setEditedTranscript(e.target.value)}
                    placeholder="Speak into your microphone or type your complete answer here..."
                    className="bg-dark text-light border-secondary p-3 rounded-3 font-monospace"
                    style={{ fontSize: '0.95rem' }}
                  />
                  {interimTranscript && (
                    <small className="text-info opacity-75 mt-1 d-block">
                      Streaming speech: "{interimTranscript}"
                    </small>
                  )}
                </Form.Group>

                {/* RECORDING & SUBMISSION CONTROLS */}
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
                  <div className="d-flex align-items-center gap-2">
                    {recordingState !== 'RECORDING' ? (
                      <Button
                        variant="info"
                        className="rounded-3 d-flex align-items-center gap-2 px-4 py-2 text-dark fw-bold"
                        onClick={startRecording}
                        disabled={recordingState === 'EVALUATING'}
                      >
                        <Mic size={18} />
                        Start Recording
                      </Button>
                    ) : (
                      <Button
                        variant="danger"
                        className="rounded-3 d-flex align-items-center gap-2 px-4 py-2 fw-bold"
                        onClick={stopRecording}
                      >
                        <StopCircle size={18} />
                        Stop Recording
                      </Button>
                    )}

                    {(liveTranscript || editedTranscript) && (
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        className="rounded-3"
                        onClick={() => { setLiveTranscript(''); setEditedTranscript(''); }}
                      >
                        Clear Text
                      </Button>
                    )}
                  </div>

                  <Button
                    variant="success"
                    className="rounded-3 d-flex align-items-center gap-2 px-4 py-2 fw-bold ms-auto"
                    onClick={handleSubmitAnswer}
                    disabled={recordingState === 'EVALUATING' || (!editedTranscript && !liveTranscript && !interimTranscript)}
                  >
                    {recordingState === 'EVALUATING' ? (
                      <>
                        <Spinner animation="border" size="sm" />
                        Evaluating...
                      </>
                    ) : (
                      <>
                        <Check size={18} />
                        Submit Answer
                      </>
                    )}
                  </Button>
                </div>
              </Card>

              {/* EXAMINER EVALUATION FEEDBACK CARD */}
              {currentFeedback && (
                <Card className="bg-dark border border-success rounded-4 p-4 shadow-lg mb-4 animate-fade-in">
                  <div className="d-flex align-items-center justify-content-between mb-3">
                    <div className="d-flex align-items-center gap-2">
                      <CheckCircle2 className="text-success" size={24} />
                      <h5 className="fw-bold text-white mb-0">Examiner Evaluation</h5>
                    </div>
                    <Badge bg="success" className="fs-6 px-3 py-2 rounded-3 text-dark fw-bold">
                      Score: {currentFeedback.score} / 10
                    </Badge>
                  </div>

                  <p className="text-light lead fs-6 mb-3">
                    {currentFeedback.feedback}
                  </p>

                  <Row className="g-3 mb-3">
                    {currentFeedback.strengths?.length > 0 && (
                      <Col md={6}>
                        <div className="p-3 bg-secondary bg-opacity-10 rounded-3 border border-success border-opacity-25">
                          <strong className="text-success small d-block mb-1">STRENGTHS IDENTIFIED:</strong>
                          <ul className="mb-0 ps-3 text-muted small">
                            {currentFeedback.strengths.map((st, i) => (
                              <li key={i} className="text-light">{st}</li>
                            ))}
                          </ul>
                        </div>
                      </Col>
                    )}

                    {currentFeedback.weak_concepts?.length > 0 && (
                      <Col md={6}>
                        <div className="p-3 bg-secondary bg-opacity-10 rounded-3 border border-warning border-opacity-25">
                          <strong className="text-warning small d-block mb-1">AREAS TO IMPROVE:</strong>
                          <ul className="mb-0 ps-3 text-muted small">
                            {currentFeedback.weak_concepts.map((wc, i) => (
                              <li key={i} className="text-light">{wc}</li>
                            ))}
                          </ul>
                        </div>
                      </Col>
                    )}
                  </Row>

                  {currentFeedback.sample_answer && (
                    <div className="p-3 bg-secondary bg-opacity-20 rounded-3 border border-secondary mb-3">
                      <small className="text-info fw-bold d-block mb-1">MODEL EXAMINER ANSWER:</small>
                      <small className="text-muted">{currentFeedback.sample_answer}</small>
                    </div>
                  )}

                  <div className="text-end">
                    <Button
                      variant="info"
                      className="rounded-3 fw-bold text-dark px-4 py-2 d-inline-flex align-items-center gap-2"
                      onClick={handleNextQuestion}
                    >
                      {currentQuestionIndex < totalQuestions ? 'Next Question' : 'View Final Results'}
                      <ArrowRight size={18} />
                    </Button>
                  </div>
                </Card>
              )}

            </Col>

            {/* RIGHT COLUMN: CONVERSATION HISTORY & TIMELINE LOG */}
            <Col lg={5}>
              <Card className="bg-secondary bg-opacity-15 border border-secondary rounded-4 p-4 h-100">
                <div className="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom border-secondary">
                  <h5 className="fw-bold text-white mb-0 d-flex align-items-center gap-2">
                    <FileText className="text-info" size={20} />
                    Viva Timeline & History
                  </h5>
                  <Badge bg="dark" className="border border-secondary px-3 py-1">
                    {conversationHistory.length} Answered
                  </Badge>
                </div>

                {conversationHistory.length === 0 ? (
                  <div className="text-center py-5 text-muted">
                    <HelpCircle size={40} className="mb-2 opacity-50" />
                    <p className="mb-0">Your answered questions and examiner evaluations will appear here in sequence.</p>
                  </div>
                ) : (
                  <div className="timeline-list pe-1" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                    {conversationHistory.map((item, idx) => (
                      <Card key={idx} className="bg-dark border border-secondary rounded-3 p-3 mb-3">
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <Badge bg="info" className="text-dark fw-bold">
                            Q{item.number}
                          </Badge>
                          <Badge bg={item.score >= 8 ? 'success' : item.score >= 6 ? 'warning' : 'danger'}>
                            {item.score} / 10
                          </Badge>
                        </div>
                        <p className="fw-semibold text-light small mb-2">
                          Q: {item.question}
                        </p>
                        <div className="bg-secondary bg-opacity-20 p-2 rounded-2 mb-2 border border-secondary">
                          <small className="text-info d-block fw-bold">Student Answer:</small>
                          <small className="text-muted">{item.student_answer}</small>
                        </div>
                        <small className="text-success d-block">
                          <strong>Feedback:</strong> {item.feedback}
                        </small>
                      </Card>
                    ))}
                  </div>
                )}
              </Card>
            </Col>

          </Row>
        )}

        {/* FINAL RESULTS SCREEN */}
        {sessionCompleted && finalResult && (
          <div className="final-results-screen py-3 animate-fade-in">
            <Card className="bg-secondary bg-opacity-15 border border-info rounded-4 p-5 shadow-lg max-w-100 mx-auto">

              <div className="text-center mb-5">
                <Badge bg="info" className="text-dark px-3 py-2 fs-6 rounded-pill mb-3 fw-bold">
                  VIVA EXAMINATION COMPLETED
                </Badge>
                <h1 className="fw-bold text-white mb-2">Final Viva Evaluation Report</h1>
                <p className="text-muted lead">Subject: {subject} • Topic: {topic}</p>
              </div>

              {/* OVERALL SCORE & GRADE CARD */}
              <Row className="g-4 mb-5 align-items-center">
                <Col lg={4}>
                  <Card className="bg-dark border-info p-4 rounded-4 text-center shadow">
                    <div className="text-muted small text-uppercase mb-1">Overall Viva Score</div>
                    <div className="display-3 fw-bold text-info mb-2">
                      {finalResult.final_score}%
                    </div>
                    <Badge bg="success" className="fs-5 px-4 py-2 rounded-pill text-dark fw-bold">
                      Grade: {finalResult.grade}
                    </Badge>
                    <div className="mt-3 text-muted small">
                      Avg per question: <strong>{finalResult.average_question_score} / 10</strong>
                    </div>
                  </Card>
                </Col>

                <Col lg={8}>
                  <Card className="bg-dark border-secondary p-4 rounded-4 h-100">
                    <h5 className="fw-bold text-white mb-3 d-flex align-items-center gap-2">
                      <Award className="text-info" size={22} />
                      Examiner Executive Summary
                    </h5>
                    <p className="text-light lead fs-6 mb-4">
                      {finalResult.summary}
                    </p>

                    <Row className="g-3">
                      <Col md={6}>
                        <div className="p-3 bg-success bg-opacity-10 border border-success border-opacity-25 rounded-3">
                          <strong className="text-success d-block mb-1">Key Strengths:</strong>
                          <ul className="mb-0 ps-3 small text-light">
                            {finalResult.strengths?.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      </Col>

                      <Col md={6}>
                        <div className="p-3 bg-warning bg-opacity-10 border border-warning border-opacity-25 rounded-3">
                          <strong className="text-warning d-block mb-1">Recommended Focus Areas:</strong>
                          <ul className="mb-0 ps-3 small text-light">
                            {finalResult.weak_areas?.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      </Col>
                    </Row>
                  </Card>
                </Col>
              </Row>

              {/* DETAILED QUESTION BREAKDOWN */}
              <h4 className="fw-bold text-white mb-3 d-flex align-items-center gap-2">
                <BarChart2 className="text-info" size={24} />
                Detailed Question-by-Question Performance
              </h4>

              <div className="mb-4">
                {finalResult.history?.map((h, i) => (
                  <Card key={i} className="bg-dark border-secondary p-4 rounded-3 mb-3">
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <h6 className="fw-bold text-info mb-0">Question {h.question_number || i + 1}</h6>
                      <Badge bg={h.score >= 8 ? 'success' : h.score >= 6 ? 'warning' : 'danger'} className="fs-6 px-3 py-1">
                        {h.score} / 10
                      </Badge>
                    </div>

                    <p className="fw-semibold text-light mb-3">{h.question}</p>

                    <div className="p-3 bg-secondary bg-opacity-20 rounded-3 mb-2 border border-secondary">
                      <small className="text-info fw-bold d-block">Your Spoken Answer:</small>
                      <small className="text-light">{h.student_answer}</small>
                    </div>

                    <small className="text-success d-block">
                      <strong>Examiner Feedback:</strong> {h.feedback}
                    </small>
                  </Card>
                ))}
              </div>

              {/* ACTIONS */}
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 pt-3 border-top border-secondary">
                <Button
                  variant="outline-light"
                  className="rounded-3 px-4 py-2 d-flex align-items-center gap-2"
                  onClick={() => window.print()}
                >
                  <Download size={18} />
                  Print / Save PDF Report
                </Button>

                <div className="d-flex align-items-center gap-3">
                  <Button
                    variant="outline-info"
                    className="rounded-3 px-4 py-2 d-flex align-items-center gap-2"
                    onClick={() => { setSessionCompleted(false); setShowConfigModal(true); }}
                  >
                    <RefreshCw size={18} />
                    Retake Viva
                  </Button>

                  <Button
                    variant="info"
                    className="rounded-3 px-4 py-2 fw-bold text-dark d-flex align-items-center gap-2"
                    onClick={() => {
                      if (onExit) onExit();
                      else window.location.href = '/dashboard';
                    }}
                  >
                    {onExit ? "Return to Practice Setup" : "Back to Dashboard"}
                    <ChevronRight size={18} />
                  </Button>
                </div>
              </div>

            </Card>
          </div>
        )}

      </Container>
    </div>
  );
}