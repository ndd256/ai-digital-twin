import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import TopStruggles from "../components/TopStruggles";
import { AuthContext } from "../context/AuthContext";

export default function Dashboard() {
  const { user } = useContext(AuthContext);

  if (!user) {
    return <div className="container py-4 text-light">Please log in to view your dashboard.</div>;
  }

  return (
    <div className="container py-4">
      {/* Revision Planner Banner Widget */}
      <div 
        className="card bg-dark border-secondary p-4 mb-4 text-light shadow-lg"
        style={{ 
          borderRadius: "16px",
          background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)",
          borderLeft: "5px solid #3B82F6" 
        }}
      >
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center">
          <div className="mb-3 mb-md-0">
            <div className="d-flex align-items-center mb-1">
              <span className="badge bg-primary text-white me-2">SM-2 Spaced Repetition</span>
              <span className="text-success small fw-semibold">
                <i className="bi bi-link-45deg me-1"></i> Connected to Struggle Predictor
              </span>
            </div>
            <h3 className="fw-bold text-white mb-1">Daily Smart Revision Planner</h3>
            <p className="text-muted mb-0 small">
              Your struggling topics are automatically scheduled into balanced daily study tasks using SuperMemo-2.
            </p>
          </div>

          <div>
            <Link to="/revision-planner" className="btn btn-primary px-4 py-2 rounded-pill fw-semibold shadow-sm">
              <i className="bi bi-calendar-check-fill me-2"></i> Open Revision Planner
            </Link>
          </div>
        </div>
      </div>

      <TopStruggles studentId={user.student_id} />
    </div>
  );
}


