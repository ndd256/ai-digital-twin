import { useContext } from "react";
import { Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import "./Header.css";

const Header = () => {
  const { user, logout } = useContext(AuthContext);

  return (
    <header
      className="p-3"
      style={{ backgroundColor: "#0F172A" }}
    >
      <div className="container-fluid px-5">
        <div className="d-flex align-items-center justify-content-between">

          {/* Logo */}
          <Link
            to="/"
            className="d-flex align-items-center text-white text-decoration-none"
          >
            <h3 className="m-0 fw-bold">
              AI Digital Twin
            </h3>
          </Link>

          {/* Navigation */}
          <ul className="nav">

            <li>
              <Link
                to="/"
                className="nav-link nav-item-custom"
              >
                Home
              </Link>
            </li>

            <li>
              <Link
                to="/library"
                className="nav-link nav-item-custom"
              >
                Library
              </Link>
            </li>

            <li>
              <Link
                to="/test"
                className="nav-link nav-item-custom"
              >
                Test Practice
              </Link>
            </li>

            <li>
              <Link to="/dashboard" className="nav-link nav-item-custom">
                Top Struggles
              </Link>
            </li>

            <li>
              <Link to="/revision-planner" className="nav-link nav-item-custom">
                <i className="bi bi-calendar-check me-1"></i>
                Revision Planner
              </Link>
            </li>


            <li>
              <Link
                to="/student-profile"
                className="nav-link nav-item-custom"
              >
                <i className="bi bi-person-circle me-1"></i>
                Student Profile
              </Link>
            </li>

            <li>
              <Link
                to="/parents-dashboard"
                className="nav-link nav-item-custom"
              >
                Parents Dashboard
              </Link>
            </li>
          </ul>

          {/* Search */}
          <form className="d-flex me-3">
            <input
              type="search"
              className="form-control"
              placeholder="Search..."
            />
          </form>

          {/* Authentication */}
          {!user ? (
            <div>
              <Link to="/login">
                <button className="btn btn-outline-light me-2">
                  Login
                </button>
              </Link>

              <Link to="/signup">
                <button className="btn btn-outline-light">
                  Sign Up
                </button>
              </Link>
            </div>
          ) : (
            <div className="d-flex align-items-center">

              {/* Avatar */}
              <div
                className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center me-2"
                style={{
                  width: "40px",
                  height: "40px",
                  fontWeight: "bold",
                }}
              >
                {user.full_name
                  ? user.full_name.charAt(0).toUpperCase()
                  : "U"}
              </div>

              {/* Name */}
              <span className="text-white me-3">
                {user.full_name || "User"}
              </span>

              {/* Logout */}
              <button
                type="button"
                className="btn btn-outline-light"
                onClick={logout}
              >
                Logout
              </button>

            </div>
          )}

        </div>
      </div>
    </header>
  );
};

export default Header;