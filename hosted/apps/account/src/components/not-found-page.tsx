import { Link } from "@tanstack/react-router";

export function NotFoundPage() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          Trainstack
        </Link>
      </header>
      <main className="content">
        <h1 className="page-title">Page not found</h1>
        <p className="lede">This address does not lead to a page. Your training is still here.</p>
        <Link to="/" className="primary link-button">
          Back to Today
        </Link>
      </main>
    </div>
  );
}
