// Sign-in, sign-up, the email code, the new-password link and the deletion links
// (prototype client/auth.html, register.html, verify.html): the signed-out nav
// (four links and the language switch) above a split screen.
import '@/styles/m-auth-account.css';
import { AuthNav } from './_ui/AuthNav';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthNav />
      <main className="wrap m-acc" id="main">{children}</main>
    </>
  );
}
