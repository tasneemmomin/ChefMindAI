function Navbar({ currentUser, onLogout }) {
  return (
    <header className="navbar">
      <div className="nav-brand-group">
        <a className="brand" href="/" aria-label="ChefMind AI Home">
          <span className="brand-icon" aria-hidden="true">✳</span>
          <span>
            ChefMind<span className="brand-ai"> AI</span>
          </span>
        </a>

        <span className="nav-tagline-divider" aria-hidden="true">/</span>

        <span className="nav-tagline">
          Your ingredients. Your preferences. Your AI chef.
        </span>
      </div>

      {currentUser && (
        <div className="nav-user-menu">
          <span className="nav-user-greeting">
            Hi, <strong>{currentUser.name || "Chef"}</strong>
          </span>
          <button
            type="button"
            className="nav-logout-btn"
            onClick={onLogout}
            aria-label="Log out of your account"
          >
            Log out
          </button>
        </div>
      )}
    </header>
  );
}

export default Navbar;

