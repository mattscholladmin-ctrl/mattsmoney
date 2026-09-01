import { createFileRoute } from "@tanstack/react-router";
import Dashboard from "@/components/Dashboard.jsx";
import Login from "@/components/Login.jsx";
import { AuthProvider, useAuth } from "@/auth/AuthProvider.jsx";
import { isSupabaseConfigured } from "@/lib/supabase.js";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Home,
});

function Home() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { session, loading } = useAuth();

  if (!isSupabaseConfigured) {
    return (
      <Dashboard
        demo
        session={{ user: { email: "matt@mattsmoney.app" } }}
      />
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-slate-500">Loading…</p>
      </div>
    );
  }

  if (!session) return <Login />;
  return <Dashboard session={session} />;
}
