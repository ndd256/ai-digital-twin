import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';

import Header from './components/Header';
import Footer from './components/Footer';

import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ParentsOverview from './pages/ParentsOverview';
import Library from './pages/Library';
import TestPage from './pages/TestPage';
import Dashboard from './pages/Dashboard';
import RevisionPlanner from './pages/RevisionPlanner';
import PDFUpload from './pages/PDFUpload';
import StudentProfile from './pages/StudentProfile';
import VivaRoom from './pages/VivaRoom';

import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';


function InfoPage({ title, description }) {
  return (
    <div
      className="container py-5 text-light text-center"
      style={{ minHeight: "60vh" }}
    >
      <div
        className="card bg-dark border-secondary p-5 mx-auto"
        style={{
          maxWidth: "600px",
          borderRadius: "16px",
        }}
      >
        <h2 className="fw-bold mb-3 text-info">
          {title}
        </h2>

        <p className="lead text-muted mb-4">
          {description}
        </p>

        <Link
          to="/"
          className="btn btn-outline-info px-4"
        >
          Return Home
        </Link>
      </div>
    </div>
  );
}


function App() {
  return (
    <AuthProvider>
      <BrowserRouter>

        <Header />

        <Routes>

          {/* Protected Student Dashboard */}
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

          {/* Protected Revision Planner */}
          <Route path="/revision-planner" element={<ProtectedRoute><RevisionPlanner /></ProtectedRoute>} />


          {/* Public Home */}
          <Route
            path="/"
            element={<Home />}
          />

          {/* Public Login */}
          <Route
            path="/login"
            element={<Login />}
          />

          {/* Public Signup */}
          <Route
            path="/signup"
            element={<Signup />}
          />

          {/* Public Library */}
          <Route
            path="/library"
            element={<Library />}
          />

          {/* Public Test Practice */}
          <Route
            path="/test"
            element={<TestPage />}
          />

          {/* AI Viva Voice Room */}
          <Route
            path="/viva"
            element={<TestPage />}
          />

          {/* Protected Parents Dashboard */}
          <Route
            path="/parents-dashboard"
            element={
              <ProtectedRoute>
                <ParentsOverview />
              </ProtectedRoute>
            }
          />

          {/* Protected PDF Upload */}
          <Route
            path="/upload-pdf"
            element={
              <ProtectedRoute>
                <PDFUpload />
              </ProtectedRoute>
            }
          />

          {/* Protected Student Profile */}
          <Route
            path="/student-profile"
            element={
              <ProtectedRoute>
                <StudentProfile />
              </ProtectedRoute>
            }
          />

        </Routes>

        <Footer />

      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
